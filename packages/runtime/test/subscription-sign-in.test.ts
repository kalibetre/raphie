import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import type { ProviderSignIn, RuntimeSettings } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { chatModel } from "./chat-model.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

/**
 * A stand-in subscription shaped like Pi's "Sign in with ChatGPT": it
 * announces a sign-in link, then waits for the final redirect address to be
 * pasted back, and hands over tokens that expire.
 */
function subscription(requests: string[], control: { refreshFails: boolean }) {
  const { models } = chatModel();
  const stock = models.getProvider("fixture")!;
  let issued = 0;
  const tokens = (lifetimeMs: number): OAuthCredential => {
    issued += 1;
    return {
      type: "oauth",
      access: `access-${issued}`,
      refresh: `refresh-${issued}`,
      expires: Date.now() + lifetimeMs,
    };
  };
  const provider: Provider = {
    ...stock,
    id: "chatgpt",
    name: "ChatGPT",
    getModels: () =>
      stock.getModels().map((model) => ({ ...model, provider: "chatgpt" })),
    streamSimple: (model, transcript, options) => {
      requests.push(options?.apiKey ?? "missing");
      return stock.streamSimple(model, transcript, options);
    },
    auth: {
      oauth: {
        name: "ChatGPT subscription",
        isSubscription: true,
        loginLabel: "Sign in with ChatGPT",
        async login(interaction, options) {
          assert.match(options?.getDeviceId?.() ?? "", /^[0-9a-f-]{36}$/);
          interaction.notify({
            type: "auth_url",
            url: "https://auth.example.test/authorize?state=s",
            instructions: "Paste the final address here.",
          });
          const pasted = await interaction.prompt({
            type: "manual_code",
            message: "Paste the final redirect URL here:",
          });
          if (!pasted.includes("code=good"))
            throw new Error("Bad redirect address");
          // Two minutes: inside the five-minute window, so the first request renews.
          return tokens(2 * 60 * 1000);
        },
        async refresh() {
          if (control.refreshFails) throw new Error("invalid_grant");
          return tokens(60 * 60 * 1000);
        },
        async toAuth(credential) {
          return { apiKey: credential.access };
        },
      },
    },
  };
  return provider;
}

test("a subscription is signed in, used, renewed, kept encrypted and signed in again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-subscription-"));
  const requests: string[] = [];
  const control = { refreshFails: false };
  const { models } = chatModel();
  const provider = subscription(requests, control);
  const keys = memoryCredentialKeyStore();
  const path = join(directory, "settings.sqlite");
  const options = {
    credentialKeyStore: keys,
    models,
    defaultModel: "history",
    subscriptionProviders: [{ id: "chatgpt", create: () => provider }],
  };
  let settings = await BackendSettings.open(path, options);
  const app = await Gateway.open({
    directory,
    models,
    modelConnectionGate: settings.connectionGate,
  });
  const follow = (current: BackendSettings) => {
    current.onChange = () => {
      app.chats.model = current.model;
    };
    current.isBusy = async () =>
      (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  };
  follow(settings);
  let server = await startServer(app, { port: 0, settings });
  const call = async <T>(route: string, body?: unknown) => {
    const response = await fetch(`${server.url}/api/settings${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const until = async (id: string, done: (s: ProviderSignIn) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const { body } = await call<ProviderSignIn>(`/sign-ins/${id}`);
      if (done(body)) return body;
      await Bun.sleep(5);
    }
    throw new Error("The sign-in did not get there");
  };
  const send = async (text: string) => {
    await app.sessions.submit(app.actors.establish("web"), {
      eventId: crypto.randomUUID(),
      text,
    });
    await app.harness.waitForIdle(context);
  };
  try {
    // Offered with Pi's own label.
    const before = (await call<RuntimeSettings>("")).body;
    assert.deepEqual(
      before.providers.find((p) => p.id === "chatgpt"),
      {
        id: "chatgpt",
        name: "ChatGPT",
        signInLabel: "Sign in with ChatGPT",
        auth: ["subscription"],
      },
    );

    // Started: the link to open is announced, then the paste is asked for.
    const started = await call<ProviderSignIn>("/sign-ins", {
      provider: "chatgpt",
      name: "My ChatGPT",
    });
    assert.equal(started.status, 201);
    const asking = await until(started.body.id, (s) => !!s.prompt);
    assert.equal(asking.status, "waiting");
    assert.deepEqual(asking.events[0], {
      type: "auth_url",
      url: "https://auth.example.test/authorize?state=s",
      instructions: "Paste the final address here.",
    });
    assert.equal(asking.prompt?.type, "manual_code");
    // Only one sign-in at a time on a host.
    const second = await call<{ error: string }>("/sign-ins", {
      provider: "chatgpt",
      name: "Another",
    });
    assert.equal(second.status, 409);
    // A stale answer is refused.
    const stale = await call(`/sign-ins/${started.body.id}/answer`, {
      promptId: "not-this-one",
      value: "http://127.0.0.1:1455/auth/callback?code=good",
    });
    assert.equal(stale.status, 409);
    // The pasted address finishes it.
    await call(`/sign-ins/${started.body.id}/answer`, {
      promptId: asking.prompt!.id,
      value: "http://127.0.0.1:1455/auth/callback?code=good&state=s",
    });
    const done = await until(started.body.id, (s) => s.status !== "waiting");
    assert.equal(done.status, "connected");
    assert.ok(done.connectionId?.startsWith("chatgpt_"));
    assert.equal(done.prompt, undefined);

    // A connection like any other, the default, with a model it offers.
    const after = (await call<RuntimeSettings>("")).body;
    assert.deepEqual(after.connections, [
      {
        id: done.connectionId,
        provider: "chatgpt",
        name: "My ChatGPT",
        credentialSource: "saved",
        auth: "subscription",
      },
    ]);
    assert.equal(after.provider, done.connectionId);
    assert.ok(after.models.some((m) => m.connectionId === done.connectionId));
    assert.ok(after.models.some((m) => m.id === after.modelId));

    // The first request renews tokens near expiry, and uses the new ones.
    app.chats.model = settings.model;
    await send("Hello");
    assert.deepEqual(requests, ["access-2"]);

    // Tokens are saved encrypted, renewed ones included, across a restart.
    await server.close();
    settings.close();
    for (const file of await readdir(directory)) {
      if (!file.startsWith("settings")) continue;
      const bytes = await readFile(join(directory, file));
      for (const secret of ["access-1", "refresh-1", "access-2", "refresh-2"])
        assert.equal(bytes.includes(Buffer.from(secret)), false, file);
    }
    settings = await BackendSettings.open(path, options);
    follow(settings);
    server = await startServer(app, { port: 0, settings });
    app.chats.model = settings.model;
    await send("Again");
    assert.deepEqual(requests, ["access-2", "access-2"]);

    // A subscription has no key to edit, and testing it works.
    assert.equal(
      (
        await call(`/connections/${done.connectionId}`, {
          name: "x",
          apiKey: "sk-nope",
        })
      ).status,
      400,
    );
    assert.equal(
      (await call(`/connections/${done.connectionId}/test`, {})).status,
      200,
    );

    // When renewal fails, the connection says to sign in again. Signing
    // in again renews it with fresh, short-lived tokens that then cannot
    // be renewed.
    control.refreshFails = true;
    const renew = await call<ProviderSignIn>("/sign-ins", {
      provider: "chatgpt",
      name: "My ChatGPT",
      connectionId: done.connectionId,
    });
    const renewAsk = await until(renew.body.id, (s) => !!s.prompt);
    await call(`/sign-ins/${renew.body.id}/answer`, {
      promptId: renewAsk.prompt!.id,
      value: "http://127.0.0.1:1455/auth/callback?code=good",
    });
    const renewed = await until(renew.body.id, (s) => s.status !== "waiting");
    assert.equal(renewed.status, "connected");
    assert.equal(renewed.connectionId, done.connectionId);
    // Its new tokens are short-lived and refresh fails now.
    const test = await call<{ error: string }>(
      `/connections/${done.connectionId}/test`,
      {},
    );
    assert.equal(test.status, 401);
    assert.match(test.body.error, /sign in again/);
    const flagged = (await call<RuntimeSettings>("")).body;
    assert.equal(flagged.connections[0]?.needsSignIn, true);

    // ...and signing in again clears it.
    control.refreshFails = false;
    const again = await call<ProviderSignIn>("/sign-ins", {
      provider: "chatgpt",
      name: "My ChatGPT",
      connectionId: done.connectionId,
    });
    const againAsk = await until(again.body.id, (s) => !!s.prompt);
    await call(`/sign-ins/${again.body.id}/answer`, {
      promptId: againAsk.prompt!.id,
      value: "http://127.0.0.1:1455/auth/callback?code=good",
    });
    await until(again.body.id, (s) => s.status === "connected");
    const cleared = (await call<RuntimeSettings>("")).body;
    assert.equal(cleared.connections.length, 1);
    assert.equal(cleared.connections[0]?.needsSignIn, undefined);

    // A sign-in can be cancelled, and frees the host for the next.
    const cancelled = await call<ProviderSignIn>("/sign-ins", {
      provider: "chatgpt",
      name: "Cancel me",
    });
    await until(cancelled.body.id, (s) => !!s.prompt);
    const stopped = await call<ProviderSignIn>(
      `/sign-ins/${cancelled.body.id}/cancel`,
      {},
    );
    assert.equal(stopped.body.status, "cancelled");
    const next = await call<ProviderSignIn>("/sign-ins", {
      provider: "chatgpt",
      name: "Next",
    });
    assert.equal(next.status, 201);
    await call(`/sign-ins/${next.body.id}/cancel`, {});

    // Unknown providers and sign-ins are refused.
    assert.equal(
      (await call("/sign-ins", { provider: "nope", name: "x" })).status,
      400,
    );
    assert.equal((await call(`/sign-ins/${crypto.randomUUID()}`)).status, 404);
  } finally {
    await server.close();
    settings.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
