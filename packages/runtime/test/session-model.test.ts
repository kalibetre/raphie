import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { chatModel } from "./chat-model.ts";

test("session models survive defaults, retries, migration and reopen without crossing sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-session-model-"));
  const requested: string[] = [];
  const config = chatModel({ requestedModel: (id) => requested.push(id) });
  const provider = config.models.getProvider("fixture")!;
  const original = provider.getModels()[0]!;
  config.models.setProvider({
    ...provider,
    getModels: () => [original, { ...original, id: "alternate" }],
  });
  const alternate = { provider: "fixture", modelId: "alternate" };
  let app = await Gateway.open({ directory, ...config });
  let http = await startServer(app, { port: 0 });
  const post = (path: string, data: unknown) =>
    fetch(`${http.url}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify(data),
    });
  try {
    const first = await app.sessions.submit(app.actors.establish("web"), {
      eventId: "first",
      text: "Hello",
    });
    await app.harness.waitForIdle(context);
    app.chats.model = alternate;
    await app.sessions.submit(app.actors.establish("web"), {
      eventId: "same-session",
      text: "Again",
      sessionId: first.sessionId,
    });
    await app.harness.waitForIdle(context);
    const second = await app.sessions.submit(app.actors.establish("web"), {
      eventId: "new-session",
      text: "New",
    });
    await app.harness.waitForIdle(context);
    assert.deepEqual(requested, ["history", "history", "alternate"]);
    assert.equal(
      (await app.queries.session(app.actors.establish("web"), first.sessionId))
        .session.model?.modelId,
      "history",
    );
    assert.equal(
      (await post(`/sessions/${first.sessionId}/model`, alternate)).status,
      200,
    );
    assert.equal(
      (
        await post(`/sessions/${first.sessionId}/model`, {
          provider: "foreign",
          modelId: "history",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(`/sessions/${first.sessionId}/model`, {
          provider: "fixture",
          modelId: "missing",
        })
      ).status,
      400,
    );
    assert.equal(
      (await post(`/sessions/${crypto.randomUUID()}/model`, alternate)).status,
      404,
    );
    const thirdResponse = await post("/sessions/messages", {
      eventId: "selected-first-message",
      text: "Chosen",
      model: config.model,
    });
    assert.equal(thirdResponse.status, 201);
    const third = await thirdResponse.json();
    await app.harness.waitForIdle(context);
    assert.equal(requested.at(-1), "history");
    const retry = await post("/sessions/messages", {
      eventId: "selected-first-message",
      text: "Chosen",
      model: config.model,
    });
    assert.equal((await retry.json()).id, third.id);
    assert.equal(requested.length, 4);
    assert.equal(
      (
        await post("/sessions/messages", {
          eventId: "selected-first-message",
          text: "Chosen",
          model: alternate,
        })
      ).status,
      409,
    );
    // Simulate a legacy record. Migration must use Pi's saved model, not the new default.
    await app.root.commit(async (tx) => {
      delete (await tx.doc(Chats)).conversations.find(
        (s) => s.sessionId === third.sessionId,
      )!.model;
    }, context);
    await http.close();
    await app.close();
    app = await Gateway.open({ directory, ...config, model: alternate });
    http = await startServer(app, { port: 0 });
    const sessions = (await app.chats.state()).conversations;
    assert.equal(
      sessions.find((s) => s.sessionId === first.sessionId)?.model?.modelId,
      "alternate",
    );
    assert.equal(
      sessions.find((s) => s.sessionId === second.sessionId)?.model?.modelId,
      "alternate",
    );
    assert.equal(
      sessions.find((s) => s.sessionId === third.sessionId)?.model?.modelId,
      "history",
    );
    await app.sessions.submit(app.actors.establish("web"), {
      eventId: "after-restart",
      text: "Still chosen",
      sessionId: third.sessionId,
    });
    await app.harness.waitForIdle(context);
    assert.equal(requested.at(-1), "history");
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("model selection cannot reconfigure a generating or queued session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-model-busy-"));
  let release!: () => void;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config = chatModel({ pause });
  const app = await Gateway.open({ directory, ...config });
  try {
    const receipt = await app.sessions.submit(app.actors.establish("web"), {
      eventId: "busy",
      text: "Waiting",
    });
    await assert.rejects(
      app.sessions.chooseModel(
        app.actors.establish("web"),
        receipt.sessionId,
        config.model,
      ),
      /current turn/,
    );
    await assert.rejects(
      app.sessions.submit(app.actors.establish("web"), {
        eventId: "busy-change",
        text: "Change",
        sessionId: receipt.sessionId,
        model: config.model,
      }),
      /current turn/,
    );
    assert.equal((await app.chats.state()).turns.length, 1);
    release();
    await app.harness.waitForIdle(context);
    await app.sessions.chooseModel(
      app.actors.establish("web"),
      receipt.sessionId,
      config.model,
    );
  } finally {
    release();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
