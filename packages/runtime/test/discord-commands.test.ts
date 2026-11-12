import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { createDiscordBridge } from "../src/infrastructure/discord/bridge.ts";
import { registerDiscordCommands } from "../src/infrastructure/discord/commands.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for Discord command response");
}

test("native Discord /home registers by upsert, verifies owner and channel, and acknowledges privately", async () => {
  const calls: {
    path: string;
    method: string;
    body: {
      name?: string;
      contexts?: number[];
      integration_types?: number[];
      content?: string;
      flags?: number;
    };
  }[] = [];
  const api = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      calls.push({
        path: new URL(request.url).pathname,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({
        id: "fixture-response",
        channel_id: "thread",
        content: "",
        author: { id: "bot", username: "raphie", bot: true },
        timestamp: new Date().toISOString(),
        attachments: [],
      });
    },
  });
  const base = `http://127.0.0.1:${api.port}`;
  const original = globalThis.fetch;
  const lookup = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const [input, init] = args;
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.origin === "https://discord.com")
          return original(
            `${base}${url.pathname.replace(/^\/api\/v10/, "")}`,
            init,
          );
        assert.equal(url.origin, base, "No external requests in this test");
        return original(input, init);
      },
      { preconnect: original.preconnect },
    ),
  );
  const directory = await mkdtemp(join(tmpdir(), "raphie-discord-native-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  const bridge = createDiscordBridge(app, {
    applicationId: "app",
    botToken: "fixture-token",
    allowedUserIds: ["owner"],
    threadId: "discord:guild:channel",
    apiUrl: base,
  });
  try {
    await bridge.registerCommands();
    await bridge.chat.initialize();
    assert.deepEqual(calls[0], {
      path: "/applications/app/commands",
      method: "POST",
      body: {
        name: "home",
        description: "Use this conversation for scheduled updates",
        type: 1,
        integration_types: [0],
        contexts: [0, 1],
      },
    });
    // Exercise the real SDK's Gateway interaction normalization, deferral and webhook reply.
    const gateway = bridge.adapter as unknown as {
      handleGatewayInteraction(interaction: unknown): Promise<void>;
    };
    const deferred: unknown[] = [];
    const invoke = (id: string, userId: string, parentId = "channel") =>
      gateway.handleGatewayInteraction({
        isChatInputCommand: () => true,
        deferReply: async (flags: unknown) => {
          deferred.push(flags);
        },
        id,
        applicationId: "app",
        token: `fixture-${id}`,
        type: 2,
        commandName: "home",
        commandId: "home-command",
        commandType: 1,
        options: { data: [] },
        channelId: "thread",
        guildId: "guild",
        channel: { id: "thread", parentId, type: 11 },
        user: { id: userId, username: userId, bot: false },
        appPermissions: { bitfield: 0n },
        entitlements: [],
        authorizingIntegrationOwners: {},
        attachmentSizeLimit: 1000,
      });
    await invoke("stranger", "stranger");
    await until(() =>
      calls.some((call) => call.path.includes("fixture-stranger")),
    );
    assert.equal((await app.home.read()).selected, null);
    assert.match(calls.at(-1)!.body.content!, /not authorized/);
    await invoke("wrong-channel", "owner", "elsewhere");
    await until(() =>
      calls.some((call) => call.path.includes("fixture-wrong-channel")),
    );
    assert.equal((await app.home.read()).selected, null);
    await invoke("accepted", "owner");
    await until(() =>
      calls.some((call) => call.path.includes("fixture-accepted")),
    );
    assert.equal(
      (await app.home.read()).destinations[0]!.conversationId,
      "discord:guild:channel:thread",
    );
    assert.match(calls.at(-1)!.body.content!, /now this bot’s home/);
    assert.equal(calls.at(-1)!.method, "PATCH");
    assert.equal(calls.at(-1)!.body.flags, 64);
    assert.deepEqual(deferred, [{ flags: 64 }, { flags: 64 }, { flags: 64 }]);
    assert.equal((await app.chats.state()).turns.length, 0);
    await app.home.select(null);
    await invoke("accepted", "owner");
    await until(
      () =>
        calls.filter((call) => call.path.includes("fixture-accepted"))
          .length === 2,
    );
    assert.equal(
      (await app.home.read()).selected,
      null,
      "Duplicate interaction cannot undo a later choice",
    );
  } finally {
    await bridge.chat.shutdown();
    await app.close();
    lookup.mockRestore();
    await api.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Discord registration errors are sanitized and do not disclose credentials", async () => {
  const request = Object.assign(
    async () => {
      throw new Error("fixture-token with request details");
    },
    { preconnect: fetch.preconnect },
  );
  await assert.rejects(
    registerDiscordCommands(
      { applicationId: "app", botToken: "fixture-token" },
      request,
    ),
    (error: Error) =>
      error.message.includes("registration failed") &&
      !error.message.includes("fixture-token"),
  );
  const denied = Object.assign(
    async () => new Response("denied", { status: 403 }),
    { preconnect: fetch.preconnect },
  );
  await assert.rejects(
    registerDiscordCommands(
      { applicationId: "app", botToken: "fixture-token" },
      denied,
    ),
    /registration failed/,
  );
});
