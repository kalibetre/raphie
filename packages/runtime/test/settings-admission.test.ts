import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate, setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { InputError } from "../src/shared/application/input-error.ts";
import { chatModel } from "./chat-model.ts";

const input = {
  source: "web" as const,
  eventId: "paused",
  actor: "owner",
  text: "Hello",
};
const busy = (error: unknown) =>
  error instanceof InputError && error.status === 409;

async function fixture(
  verifyKey: (key: string) => Promise<void> = async () => {},
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-settings-admission-"));
  const generation = Promise.withResolvers<void>();
  const { models } = chatModel({ pause: generation.promise });
  // Use the real Settings/OpenRouter wiring with a deterministic, network-free provider.
  const provider = models.getProvider("fixture")!;
  models.setProvider({
    ...provider,
    id: "openrouter",
    getModels: () =>
      provider
        .getModels()
        .map((model) => ({ ...model, provider: "openrouter" })),
  });
  const settings = await BackendSettings.open(
    join(directory, "settings.sqlite"),
    {
      models,
      defaultModel: "history",
      verifyKey,
    },
  );
  await settings.update({ apiKey: "original-fixture-key" });
  const app = await Gateway.open({
    directory,
    models,
    model: settings.model,
    modelConnectionGate: settings.connectionGate,
  });
  settings.onChange = () => {
    app.chats.model = settings.model;
  };
  settings.isBusy = async () =>
    (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  return {
    app,
    settings,
    generation,
    close: async () => {
      generation.resolve();
      await app.close();
      settings.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function pauseAdmission(app: Gateway) {
  const paused = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const commit = app.root.commit.bind(app.root);
  const spy = spyOn(app.root, "commit").mockImplementationOnce(
    async (...args) => {
      paused.resolve();
      await resume.promise;
      return commit(...args);
    },
  );
  return {
    paused: paused.promise,
    resume: () => resume.resolve(),
    restore: () => spy.mockRestore(),
  };
}

for (const change of [
  { name: "disconnect", input: { providerEnabled: false } },
  { name: "remove credentials", input: { apiKey: null } },
  { name: "replace credentials", input: { apiKey: "replacement-fixture-key" } },
]) {
  test(`provider cannot ${change.name} while admission is paused before its transaction`, async () => {
    const { app, settings, close, generation } = await fixture();
    const admission = pauseAdmission(app);
    const sending = app.chats.send(input);
    let updating: Promise<number> | undefined;
    try {
      await admission.paused;
      assert.equal((await app.chats.state()).turns.length, 0);
      const checked = Promise.withResolvers<void>();
      const isBusy = settings.isBusy;
      settings.isBusy = async () => {
        const result = await isBusy();
        checked.resolve();
        return result;
      };
      updating = settings.update(change.input).then(
        () => 200,
        (error: unknown) => {
          if (error instanceof InputError) return error.status;
          throw error;
        },
      );
      await checked.promise;
      // Drain busy-check/verification continuations while admission stays paused.
      await setImmediate();
      admission.resume();
      const sent = await sending;
      assert.equal(await updating, 409);
      assert.equal((await settings.read()).providerEnabled, true);
      assert.equal(settings.key === "original-fixture-key", true);
      assert.equal(
        (await app.chats.state()).turns.find((turn) => turn.id === sent.id)
          ?.status,
        "pending",
      );
      // Admission releases its gate, while the persisted-turn guard remains in force.
      await assert.rejects(settings.update(change.input), busy);
      await settings.update({ telemetryEnabled: false });
      generation.resolve();
      for (let n = 0; n < 200 && (await settings.isBusy()); n++)
        await delay(10);
      assert.equal(await settings.isBusy(), false);
      await settings.update(change.input);
    } finally {
      admission.resume();
      await Promise.allSettled([sending, ...(updating ? [updating] : [])]);
      admission.restore();
      await close();
    }
  });
}

test("failed admission releases the gate for a queued replacement and subsequent admission", async () => {
  const { app, settings, close } = await fixture();
  const admission = pauseAdmission(app);
  const sending = assert.rejects(
    app.chats.send({ ...input, sessionId: "missing" }),
    /Session not found/,
  );
  let updating: Promise<unknown> | undefined;
  try {
    await admission.paused;
    updating = settings.update({ apiKey: "replacement-fixture-key" });
    await setImmediate();
    admission.resume();
    await sending;
    await updating;
    assert.equal((await app.chats.state()).turns.length, 0);
    assert.equal(settings.key === "replacement-fixture-key", true);
    const sent = await app.chats.send(input);
    assert.equal(
      (await app.chats.state()).turns.find((turn) => turn.id === sent.id)
        ?.status,
      "pending",
    );
    await assert.rejects(settings.update({ providerEnabled: false }), busy);
  } finally {
    admission.resume();
    await Promise.allSettled([sending, ...(updating ? [updating] : [])]);
    admission.restore();
    await close();
  }
});

for (const disconnect of [true, false]) {
  test(`admission observes ${disconnect ? "disconnect" : "replacement"} when settings owns the gate first`, async () => {
    const { app, settings, close } = await fixture();
    const checked = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let checks = 0;
    const isBusy = settings.isBusy;
    settings.isBusy = async () => {
      const result = await isBusy();
      if (++checks === 2) {
        checked.resolve();
        await resume.promise;
      }
      return result;
    };
    const updating = settings.update(
      disconnect
        ? { providerEnabled: false }
        : { apiKey: "replacement-fixture-key" },
    );
    let sending: Promise<unknown> | undefined;
    try {
      await checked.promise;
      let settled = false;
      sending = app.chats.send(input).then(
        (result) => {
          settled = true;
          return result;
        },
        (error: unknown) => {
          settled = true;
          throw error;
        },
      );
      // A queued send must not capture the old model during the final busy check.
      await setImmediate();
      assert.equal(settled, false);
      resume.resolve();
      await updating;
      if (disconnect) {
        await assert.rejects(sending, /Connect a model provider/);
        assert.equal((await app.chats.state()).turns.length, 0);
        // Rejection before the transaction also releases the admission gate.
        await settings.update({ providerEnabled: true });
        await app.chats.send({ ...input, eventId: "reconnected" });
      } else {
        await sending;
        assert.equal(settings.key === "replacement-fixture-key", true);
      }
    } finally {
      resume.resolve();
      await Promise.allSettled([updating, ...(sending ? [sending] : [])]);
      await close();
    }
  });
}

test("a turn admitted during credential verification still blocks the verified replacement", async () => {
  const verifying = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const { app, settings, close } = await fixture(async (key) => {
    if (key === "replacement-fixture-key") {
      verifying.resolve();
      await resume.promise;
    }
  });
  const updating = assert.rejects(
    settings.update({ apiKey: "replacement-fixture-key" }),
    busy,
  );
  try {
    await verifying.promise;
    await app.chats.send(input);
    resume.resolve();
    await updating;
    assert.equal(settings.key === "original-fixture-key", true);
  } finally {
    resume.resolve();
    await updating;
    await close();
  }
});
