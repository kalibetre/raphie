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

test("summary thresholds scale with the window, and a large one works in at most 64k", () => {
  // Where a summary starts in the background.
  const start = (window: number) => {
    const policy = compactionPolicy(window);
    return window - policy.reserveTokens - policy.backgroundTokens;
  };
  // A bot's one chat never ends, so a large window is not filled: every
  // message would pay for it.
  expect(compactionPolicy(1_000_000)).toEqual({
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
    backgroundTokens: 919_616,
  });
  for (const window of [1_000_000, 200_000, 128_000])
    expect(start(window)).toBe(64_000);
  expect(compactionPolicy(200_000)).toEqual({
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
    backgroundTokens: 119_616,
  });
  // A small window keeps its share, and room between keeping and summarizing.
  const small = compactionPolicy(32_000);
  expect(small).toEqual({
    reserveTokens: 3_200,
    keepRecentTokens: 8_000,
    backgroundTokens: 4_800,
  });
  expect(start(32_000)).toBeGreaterThan(small.keepRecentTokens * 2);
});

/** A chat of twenty long messages on a 24k window, so it is summarized once. */
async function longChat(
  check: (app: Gateway, sessionId: string, seen: string[][]) => Promise<void>,
  options: { failNotes?: boolean; notes?: (transcript: string) => void } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-compaction-"));
  const seen: string[][] = [];
  const app = await Gateway.open({
    directory,
    ...chatModel({
      contextWindow: 24_000,
      userMessages: (messages) => seen.push(messages.map(text)),
      ...options,
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
    // Scaled to the 24k window: late, and once or twice as the instructions
    // grow. The library's fixed defaults would summarize from the first few
    // turns on.
    expect(summarized.length).toBeGreaterThanOrEqual(1);
    expect(summarized.length).toBeLessThanOrEqual(2);
    expect(
      turns.findIndex((turn) => turn.id === summarized[0]!.id),
    ).toBeGreaterThan(10);
    await check(app, first.sessionId, seen);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("a long chat is summarized as the bot's notes and keeps answering", async () => {
  const read: string[] = [];
  await longChat(
    async (app, sessionId, seen) => {
      const [turn] = (await app.chats.state()).turns.filter(
        (t) => t.compaction,
      );
      expect(turn!.compaction).toMatchObject({
        reason: "threshold",
        summary: "## Commitments\n- Fixture notes of the earlier messages.",
      });
      // The summarizer read a transcript of the earliest messages.
      expect(read.length).toBeGreaterThanOrEqual(1);
      expect(read[0]).toContain("[Message]: ");
      expect(read[0]).toContain("Message 0 ");

      // The newest request starts from the notes, not from message 0.
      // The chat's newest request, not a summary's own.
      const last = seen
        .filter((request) => !request.some((m) => m.startsWith("<transcript>")))
        .at(-1)!;
      expect(last.some((m) => m.includes("Fixture notes"))).toBe(true);
      expect(last.some((m) => m.includes("Message 0 "))).toBe(false);
      expect(last.at(-1)).toContain("Message 19 ");

      const history = await app.queries.history(
        app.actors.establish("web"),
        sessionId,
      );
      expect(history.items.some((t) => t.compaction)).toBe(true);
      const activity = (await app.harness.snapshot(
        Activity,
        BACKGROUND_CONTEXT,
      ))!.events.map((e) => e.type);
      expect(activity).toContain("compaction.started");
      expect(activity).toContain("compaction.completed");
    },
    { notes: (transcript) => read.push(transcript) },
  );
}, 30_000);

test("when the bot's notes fail, Pi's own summary takes their place", async () => {
  await longChat(
    async (app, _sessionId, seen) => {
      const [turn] = (await app.chats.state()).turns.filter(
        (t) => t.compaction,
      );
      expect(turn!.compaction?.summary).toBe(
        "Fixture summary of the earlier messages.",
      );
      expect(seen.at(-1)!.some((m) => m.includes("Fixture summary"))).toBe(
        true,
      );
    },
    { failNotes: true },
  );
}, 30_000);
