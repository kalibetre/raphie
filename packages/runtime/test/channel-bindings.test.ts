import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { ChannelBindings } from "../src/domains/channels/infrastructure/pi-bindings.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { chatModel } from "./chat-model.ts";

test("bindings migrate once and retain session IDs, event admission and turn destinations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bindings-"));
  const input = {
    source: "discord" as const,
    actor: "owner",
    eventId: "legacy",
    text: "hello",
    discordThreadId: "discord:guild:channel:original",
  };
  let app = await Gateway.open({ directory, ...chatModel() });
  try {
    const original = await app.chats.send(input);
    for (
      let n = 0;
      n < 100 && (await app.chats.state()).turns[0].status === "pending";
      n++
    )
      await delay(10);
    await app.root.commit(async (tx) => {
      const chats = await tx.doc(Chats);
      Object.assign(chats.conversations[0], {
        discordThreadId: input.discordThreadId,
      });
      Reflect.deleteProperty(chats.turns[0], "replyTo");
      (await tx.doc(ChannelBindings)).bindings = [];
    }, context);
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    assert.deepEqual(await app.chats.send(input), original);
    const bindings = (await app.harness.snapshot(ChannelBindings, context))!
      .bindings;
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].sessionId, original.sessionId);
    assert.equal(
      "discordThreadId" in (await app.chats.state()).conversations[0],
      false,
    );
    const second = await app.chats.send({
      ...input,
      eventId: "other-connection",
      connectionId: "second-bot",
    });
    assert.notEqual(second.sessionId, original.sessionId);
    await assert.rejects(
      app.chats.send({ ...input, connectionId: "second-bot" }),
      /another Discord connection/,
    );
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    assert.equal(
      (await app.harness.snapshot(ChannelBindings, context))!.bindings.length,
      2,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an admitted reply keeps its origin even if its binding changes while the model is running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-origin-"));
  let release!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await Gateway.open({
    directory,
    ...chatModel({ pause, started }),
  });
  try {
    const origin = "discord:guild:channel:original";
    await app.sessions.submit(app.actors.establish("discord", origin), {
      eventId: "slow",
      text: "hello",
    });
    await active;
    await app.root.commit(async (tx) => {
      (await tx.doc(ChannelBindings)).bindings[0].conversation =
        "discord:guild:channel:changed";
    }, context);
    release();
    for (
      let n = 0;
      n < 100 && !(await app.chats.state()).deliveries.length;
      n++
    )
      await delay(10);
    assert.equal((await app.chats.state()).deliveries[0].threadId, origin);
  } finally {
    release();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
