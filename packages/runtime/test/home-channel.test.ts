import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { homeRoutes } from "../src/domains/channels/presentation/http/home-routes.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for scheduled result");
}

test("home is verified, bot-scoped and durable; settings accepts only known destinations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-home-"));
  let app = await Gateway.open({ directory, ...chatModel() });
  const otherDir = await mkdtemp(join(tmpdir(), "raphie-home-other-"));
  const other = await Gateway.open({
    directory: otherDir,
    botId: "other",
    ...chatModel(),
  });
  try {
    const actor = app.actors.establish(
      "telegram",
      "telegram:42",
      "telegram:123",
      "42",
    );
    await assert.rejects(app.home.setCurrent({ ...actor }), /authorized/);
    await assert.rejects(other.home.setCurrent(actor), /authorized/);
    await assert.rejects(
      app.home.setCurrent(app.actors.establish("web")),
      /verified/,
    );
    await app.home.setCurrent(actor, "command-1");
    const saved = await app.home.read();
    assert.equal(saved.destinations.length, 1);
    assert.equal(saved.destinations[0]!.conversationId, "telegram:42");
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    assert.deepEqual(await app.home.read(), saved);
    assert.equal((await other.home.read()).selected, null);
    await assert.rejects(
      app.home.select("telegram:arbitrary"),
      /known channel/,
    );
    const routes = homeRoutes(app.home);
    const response = await routes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: null }),
    });
    assert.equal(response.status, 200);
    await app.home.select(null);
    await app.home.setCurrent(
      app.actors.establish("telegram", "telegram:42", "telegram:123", "42"),
      "command-1",
    );
    assert.equal(
      (await app.home.read()).selected,
      null,
      "replayed /home cannot undo a later Settings choice",
    );
    assert.equal((await app.home.read()).selected, null);
    await app.home.select(saved.selected);
    assert.equal((await app.home.read()).selected, saved.selected);
  } finally {
    await app.close();
    await other.close();
    await rm(directory, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});

test("scheduled turns freeze the bot home without linking sessions; ordinary web replies stay local", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-home-frozen-"));
  let release!: () => void;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await Gateway.open({ directory, ...chatModel({ pause }) });
  app.home.available = () => true;
  try {
    await app.home.setCurrent(
      app.actors.establish("telegram", "telegram:42", "telegram:123", "42"),
    );
    const owner = app.actors.establish("web");
    const submitted = await app.sessions.submitScheduled(owner, {
      eventId: "job-1",
      text: "morning summary",
      scheduled: { name: "Morning" },
    });
    await app.home.setCurrent(
      app.actors.establish(
        "discord",
        "discord:guild:channel:thread",
        "discord-app",
        "owner",
      ),
    );
    const scheduled = (await app.chats.state()).turns.find(
      (turn) => turn.id === submitted.id,
    )!;
    assert.equal(scheduled.replyTo?.conversation, "telegram:42");
    assert.equal(scheduled.scheduledDelivery, "home");
    const web = await app.sessions.submit(owner, {
      eventId: "web",
      text: "hello",
    });
    assert.equal(
      (await app.chats.state()).turns.find((turn) => turn.id === web.id)
        ?.replyTo,
      null,
    );
    release();
    await until(async () =>
      (await app.chats.state()).turns.every(
        (turn) => turn.status !== "pending",
      ),
    );
    const state = await app.chats.state();
    assert.equal(state.deliveries.length, 1);
    assert.equal(state.deliveries[0]!.threadId, "telegram:42");
    assert.match(state.deliveries[0]!.text, /^Scheduled: Morning/);
    assert.notEqual(submitted.sessionId, web.sessionId);
    app.home.available = () => false;
    const unavailable = await app.sessions.submitScheduled(owner, {
      eventId: "job-2",
      text: "later",
      sessionId: submitted.sessionId,
      scheduled: { name: "Later" },
    });
    const turn = (await app.chats.state()).turns.find(
      (item) => item.id === unavailable.id,
    )!;
    assert.equal(turn.replyTo, null);
    assert.equal(turn.scheduledDelivery, "home-unavailable");
    await until(async () =>
      (await app.chats.state()).turns.every(
        (item) => item.status !== "pending",
      ),
    );
    assert.equal((await app.chats.state()).deliveries.length, 1);
  } finally {
    release();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel origins survive admission and client reads; ordinary messages register settings candidates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-origin-"));
  let instructions = "";
  const app = await Gateway.open({
    directory,
    ...chatModel({
      systemPrompt: (value) => {
        instructions = value;
      },
    }),
  });
  try {
    const actor = app.actors.establish(
      "discord",
      "discord:guild:channel:thread",
      "app-id",
      "user-id",
      { messageId: "message-id" },
    );
    const receipt = await app.sessions.submit(actor, {
      eventId: "message-id",
      text: "hello",
    });
    await until(
      async () => (await app.chats.state()).turns[0]?.status === "done",
    );
    const expected = {
      platform: "discord",
      connectionId: "app-id",
      conversationId: "discord:guild:channel:thread",
      channelId: "channel",
      threadId: "thread",
      guildId: "guild",
      userId: "user-id",
      messageId: "message-id",
    };
    assert.deepEqual((await app.chats.state()).turns[0]!.origin, expected);
    assert.match(instructions, /runtime-verified routing metadata/);
    const history = await app.queries.history(
      app.actors.establish("web"),
      receipt.sessionId,
    );
    assert.deepEqual(history.items[0]!.origin, expected);
    assert.equal((await app.home.read()).destinations.length, 1);
    assert.equal((await app.home.read()).selected, null);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
