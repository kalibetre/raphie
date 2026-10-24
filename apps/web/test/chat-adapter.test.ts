import { test } from "bun:test";
import assert from "node:assert/strict";

import { EventType } from "@tanstack/ai";
import { ChatClient } from "@tanstack/ai-client";

import {
  chatAdapter,
  transcript,
} from "../src/domains/conversations/infrastructure/chat-adapter.ts";
import type { Snapshot } from "../src/infrastructure/http/api-client.ts";

const state: Snapshot = {
  conversations: [],
  model: null,
  mcp: { connected: false, error: false, server: null, toolCount: 0 },
  uncertainToolDeliveries: [],
  toolApprovals: [],
  activity: [],
  turns: [
    {
      id: "turn",
      conversationId: "session-1",
      text: "Hello",
      status: "pending",
      answer: null,
      source: "web",
      createdAt: 1,
    },
  ],
  live: { "session-1": { text: "Hel", generating: true, usage: null } },
};

test("TanStack AI consumes authoritative partial and completed transcripts without duplicate replies", async () => {
  let publish!: (state: Snapshot) => void;
  let detached = 0;
  const adapter = chatAdapter("session-1", (listener) => {
    publish = listener;
    return () => {
      detached++;
    };
  });
  const client = new ChatClient({ connection: adapter });
  client.subscribe();
  publish(state);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.getMessages().length, 2);
  assert.deepEqual(client.getMessages()[1].parts, [
    { type: "text", content: "Hel" },
  ]);
  const completed = {
    ...state,
    turns: [
      { ...state.turns[0], answer: "Hello there", status: "done" as const },
    ],
  };
  publish(completed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.getMessages().length, 2);
  assert.equal(client.getMessages()[1].id, "turn:reply");
  assert.deepEqual(client.getMessages()[1].parts, [
    { type: "text", content: "Hello there" },
  ]);
  client.unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(detached, 1);
  assert.equal(state.turns[0].status, "pending");
});

test("reconnect reconstructs only the selected conversation and omits stale live text", () => {
  const completed = {
    ...state,
    turns: [
      { ...state.turns[0], status: "done" as const, answer: "Saved answer" },
      {
        ...state.turns[0],
        id: "other",
        conversationId:
          "session-2" as Snapshot["turns"][number]["conversationId"],
      },
    ],
  };
  const chunk = transcript(completed, "session-1");
  assert.equal(chunk.type, EventType.MESSAGES_SNAPSHOT);
  if (chunk.type === EventType.MESSAGES_SNAPSHOT) {
    assert.equal(chunk.messages.length, 2);
    assert.equal(chunk.messages[1].content, "Saved answer");
  }
});

test("a pending reply stays visible between model steps and yields to the final answer", async () => {
  let publish!: (state: Snapshot) => void;
  const client = new ChatClient({
    connection: chatAdapter("session-1", (listener) => {
      publish = listener;
      return () => {};
    }),
  });
  client.subscribe();
  const show = async (snapshot: Snapshot) => {
    publish(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const reply = () => client.getMessages().find((m) => m.id === "turn:reply");
  try {
    await show(state);
    assert.deepEqual(reply()?.parts, [{ type: "text", content: "Hel" }]);
    await show({
      ...state,
      live: { "session-1": { text: "Hel", generating: false, usage: null } },
    } as Snapshot);
    assert.deepEqual(reply()?.parts, [{ type: "text", content: "Hel" }]);
    await show({
      ...state,
      live: { "session-1": { text: "", generating: true, usage: null } },
    } as Snapshot);
    assert.deepEqual(reply()?.parts, [{ type: "text", content: "Hel" }]);
    await show({
      ...state,
      live: { "session-1": { text: "Final", generating: true, usage: null } },
    } as Snapshot);
    assert.deepEqual(reply()?.parts, [{ type: "text", content: "Final" }]);
    await show({
      ...state,
      live: { "session-1": { text: "Final", generating: false, usage: null } },
    } as Snapshot);
    assert.deepEqual(reply()?.parts, [{ type: "text", content: "Final" }]);
    const completed = {
      ...state,
      turns: [{ ...state.turns[0], status: "done", answer: "Final answer" }],
    } as Snapshot;
    await show(completed);
    assert.deepEqual(reply()?.parts, [
      { type: "text", content: "Final answer" },
    ]);
    await show({
      ...completed,
      turns: [
        ...completed.turns,
        { ...state.turns[0], id: "next-turn", text: "Another question" },
      ],
      live: { "session-1": { text: "Final", generating: false, usage: null } },
    } as Snapshot);
    assert.equal(client.getMessages().length, 3);
    assert(!client.getMessages().some((m) => m.id === "next-turn:reply"));
  } finally {
    client.unsubscribe();
  }
});
