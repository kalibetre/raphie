import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { chatModel } from "./chat-model.ts";

const web = (eventId: string, text = eventId) => ({
  source: "web" as const,
  actor: "owner",
  eventId,
  text,
});

test("everything the owner writes from an app goes to the bot's one chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const first = await app.chats.send(web("first"));
    const second = await app.chats.send(web("second"));
    assert.equal(second.sessionId, first.sessionId);
    await app.harness.waitForIdle(context);
    const { conversations } = await app.chats.state();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0]!.chat, true);
    const owner = app.actors.establish("web");
    assert.equal(
      (await app.queries.session(owner, first.sessionId)).session.chat,
      true,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a bot from before chats keeps its latest app conversation as its chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-legacy-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  // Before chats, every message without a session started a new one.
  const unmark = () =>
    app.root.commit(async (tx) => {
      for (const item of (await tx.doc(Chats)).conversations)
        Reflect.deleteProperty(item, "chat");
    }, context);
  try {
    const older = await app.chats.send(web("older"));
    await unmark();
    const latest = await app.chats.send(web("latest"));
    await unmark();
    // A channel's conversation is newer, but never becomes the app's chat.
    const channel = await app.chats.send({
      ...web("channel"),
      source: "discord",
      discordThreadId: "discord:guild:channel:one",
    });
    await app.harness.waitForIdle(context);
    await app.close();
    app = await Gateway.open({ directory, ...config });
    const chats = (await app.chats.state()).conversations.filter((c) => c.chat);
    assert.deepEqual(
      chats.map((c) => c.sessionId),
      [latest.sessionId],
    );
    assert.notEqual(older.sessionId, latest.sessionId);
    assert.notEqual(channel.sessionId, latest.sessionId);
    // The owner carries on where they last were.
    assert.equal(
      (await app.chats.send(web("next"))).sessionId,
      latest.sessionId,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
