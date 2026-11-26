import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";
import { withoutChat } from "./without-chat.ts";

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
  try {
    // Before chats, every message without a session started a new one.
    const older = await app.chats.send(web("older"));
    await withoutChat(app);
    const latest = await app.chats.send(web("latest"));
    await withoutChat(app);
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

const channel = (
  eventId: string,
  conversation: string,
  provider: "telegram" | "discord" = "telegram",
) => ({
  source: provider,
  actor: "owner",
  eventId,
  text: eventId,
  discordThreadId: conversation,
  connectionId: provider === "telegram" ? "telegram:1" : "discord-app",
  discordUserId: "42",
});

test("private channel chats join the chat; groups and server channels keep their own", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-channels-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const chat = (await app.chats.send(web("app"))).sessionId;
    assert.equal(
      (await app.chats.send(channel("telegram", "telegram:42"))).sessionId,
      chat,
    );
    assert.equal(
      (await app.chats.send(channel("dm", "discord:@me:7", "discord")))
        .sessionId,
      chat,
    );
    const group = (await app.chats.send(channel("group", "telegram:-100")))
      .sessionId;
    const server = (
      await app.chats.send(channel("server", "discord:guild:7", "discord"))
    ).sessionId;
    assert.equal(new Set([chat, group, server]).size, 3);
    // Each reply goes back where its message came from.
    await app.harness.waitForIdle(context);
    const { turns } = await app.chats.state();
    assert.equal(
      turns.find((t) => t.text === "telegram")?.replyTo?.conversation,
      "telegram:42",
    );
    assert.equal(turns.find((t) => t.text === "app")?.replyTo, null);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a private channel chat from before chats moves to the chat; its old session stays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-rebind-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    const telegram = await app.chats.send(channel("before", "telegram:42"));
    await withoutChat(app);
    const latest = await app.chats.send(web("latest"));
    await withoutChat(app);
    await app.harness.waitForIdle(context);
    assert.notEqual(telegram.sessionId, latest.sessionId);
    await app.close();
    app = await Gateway.open({ directory, ...config });
    assert.equal(
      (await app.chats.send(channel("after", "telegram:42"))).sessionId,
      latest.sessionId,
    );
    assert.ok(
      (await app.chats.state()).conversations.some(
        (c) => c.sessionId === telegram.sessionId && !c.chat,
      ),
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
