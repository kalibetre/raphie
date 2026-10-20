import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatClient } from "@tanstack/ai-client";
import { EventType } from "@tanstack/ai";
import { transcript, chatAdapter } from "../src/lib/chat-adapter.ts";
import type { Snapshot } from "../src/lib/api.ts";

const state = {
  turns: [
    {
      id: "turn",
      conversationId: 1,
      text: "Hello",
      status: "pending",
      answer: null,
    },
  ],
  live: { 1: { text: "Hel", generating: true } },
} as unknown as Snapshot;

test("TanStack AI consumes authoritative partial and completed transcripts without duplicate replies", async () => {
  let publish!: (state: Snapshot) => void;
  let detached = 0;
  const adapter = chatAdapter(1, (listener) => {
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
        conversationId: 2 as Snapshot["turns"][number]["conversationId"],
      },
    ],
  };
  const chunk = transcript(completed, 1);
  assert.equal(chunk.type, EventType.MESSAGES_SNAPSHOT);
  if (chunk.type === EventType.MESSAGES_SNAPSHOT) {
    assert.equal(chunk.messages.length, 2);
    assert.equal(chunk.messages[1].content, "Saved answer");
  }
});
