import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { UserMessage } from "@earendil-works/pi-ai";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Activity } from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { compactionPolicy } from "../src/domains/conversations/domain/compaction.ts";
import { chatModel } from "./chat-model.ts";

async function answered(app: Gateway, id: string) {
  for (let n = 0; n < 500; n++) {
    const turn = (await app.chats.state()).turns.find((t) => t.id === id)!;
    if (turn.status !== "pending") return turn;
    await delay(10);
  }
  throw new Error("Model reply did not settle");
}

function text(message: UserMessage) {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .flatMap((c) => (c.type === "text" ? [c.text] : []))
        .join("");
}

test("summary thresholds scale with the window, capped at the library defaults", () => {
  expect(compactionPolicy(1_000_000)).toEqual({
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
    backgroundTokens: 32_768,
  });
  expect(compactionPolicy(200_000)).toEqual({
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
    backgroundTokens: 30_000,
  });
  // A small window still leaves room between keeping and summarizing.
  const small = compactionPolicy(32_000);
  expect(small).toEqual({
    reserveTokens: 3_200,
    keepRecentTokens: 8_000,
    backgroundTokens: 4_800,
  });
  expect(32_000 - small.reserveTokens - small.backgroundTokens).toBeGreaterThan(
    small.keepRecentTokens * 2,
  );
});

test("a long session summarizes its earlier messages and keeps answering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-compaction-"));
  const seen: string[][] = [];
  const app = await Gateway.open({
    directory,
    ...chatModel({
      contextWindow: 24_000,
      userMessages: (messages) => seen.push(messages.map(text)),
    }),
  });
  try {
    const first = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "0",
      text: `Message 0 ${"remember this detail. ".repeat(170)}`,
    });
    const turns = [await answered(app, first.id)];
    for (let n = 1; n < 20; n++) {
      const sent = await app.chats.send({
        source: "web",
        actor: "owner",
        eventId: String(n),
        text: `Message ${n} ${"remember this detail. ".repeat(170)}`,
        conversationId: first.conversationId,
      });
      turns.push(await answered(app, sent.id));
    }

    expect(turns.map((turn) => turn.status)).toEqual(turns.map(() => "done"));
    expect(turns.at(-1)!.answer).toStartWith("Noted:");

    const summarized = (await app.chats.state()).turns.filter(
      (turn) => turn.conversationId === first.conversationId && turn.compaction,
    );
    // Scaled to the 24k window: once, late. The library's fixed defaults
    // would summarize from the first few turns on.
    expect(summarized.length).toBe(1);
    expect(
      turns.findIndex((turn) => turn.id === summarized[0]!.id),
    ).toBeGreaterThan(10);
    expect(summarized[0]!.compaction).toMatchObject({
      reason: "threshold",
      summary: "Fixture summary of the earlier messages.",
    });

    // The newest request starts from the summary, not from message 0.
    const last = seen.at(-1)!;
    expect(last.some((m) => m.includes("Fixture summary"))).toBe(true);
    expect(last.some((m) => m.includes("Message 0 "))).toBe(false);
    expect(last.at(-1)).toContain("Message 19 ");

    const history = await app.queries.history(
      app.actors.establish("web"),
      first.sessionId,
    );
    expect(history.items.some((turn) => turn.compaction)).toBe(true);

    const activity = (await app.harness.snapshot(
      Activity,
      BACKGROUND_CONTEXT,
    ))!.events.map((e) => e.type);
    expect(activity).toContain("compaction.started");
    expect(activity).toContain("compaction.completed");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
