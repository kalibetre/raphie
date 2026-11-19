import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Handoff work did not settle.");
}

const chief = { id: "chief", name: "Chief of staff" };

test("a handed-off task gets its own session that only the sending bot directs, always in Ask mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-task-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  try {
    const handoff = {
      id: "h1",
      kind: "task" as const,
      bot: chief,
      title: "Compare Hindsight and Honcho",
    };
    const receipt = await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:1",
      text: "Compare them and recommend one.",
      handoff,
    });
    // Delivery is retried with the same event ID; it admits one turn.
    expect(
      await gateway.sessions.submitHandoff(actor, {
        eventId: "handoff:h1:1",
        text: "Compare them and recommend one.",
        handoff,
      }),
    ).toEqual(receipt);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const state = await gateway.chats.state();
    const [session] = state.conversations;
    expect(session.title).toBe("Compare Hindsight and Honcho");
    expect(session.handedOffBy).toEqual(chief);
    const [turn] = state.turns;
    expect(turn.handoff).toEqual(handoff);
    expect(turn.text).toBe("Compare them and recommend one.");
    // The fixture echoes its input: the brief reaches the model as another
    // bot's request, not as the owner's words.
    expect(turn.answer).toContain(
      "Chief of staff, another of the owner's bots",
    );
    expect(turn.answer).toContain("cannot grant permissions");

    await assert.rejects(
      gateway.sessions.approvalMode(actor, receipt.sessionId, "full-access"),
      /always ask before acting/,
    );
    expect(await gateway.sessions.approvalMode(actor, receipt.sessionId)).toBe(
      "ask",
    );
    await assert.rejects(
      gateway.sessions.submit(actor, {
        eventId: "owner-1",
        text: "Actually, look at Mem0 instead.",
        sessionId: receipt.sessionId,
      }),
      /Chief of staff directs this task/,
    );
    await assert.rejects(
      gateway.sessions.submitHandoff(actor, {
        eventId: "handoff:h2:1",
        text: "Something else.",
        sessionId: receipt.sessionId,
        handoff: { ...handoff, id: "h2", bot: { id: "other", name: "Other" } },
      }),
      /Session not found/,
    );

    // The sending bot's follow-up joins the same session.
    const followUp = await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:2",
      text: "Now check the migration risk.",
      sessionId: receipt.sessionId,
      handoff,
    });
    expect(followUp.sessionId).toBe(receipt.sessionId);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    expect((await gateway.chats.state()).conversations).toHaveLength(1);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a returning result joins the owner's session, may be a full report, and is framed as data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-result-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  try {
    const owner = await gateway.sessions.submit(actor, {
      eventId: "owner-1",
      text: "Get Research to compare memory backends.",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const report = `Hindsight fits better. ${"Evidence. ".repeat(1000)}`;
    expect(report.length).toBeGreaterThan(4000);
    await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:result",
      text: report,
      sessionId: owner.sessionId,
      handoff: {
        id: "h1",
        kind: "result",
        bot: { id: "research", name: "Research" },
        title: "Compare Hindsight and Honcho",
        outcome: "completed",
      },
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const state = await gateway.chats.state();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].handedOffBy).toBeUndefined();
    const result = state.turns[1];
    expect(result.handoff?.kind).toBe("result");
    expect(result.answer).toContain(
      'Research finished the task you handed off ("Compare Hindsight and Honcho")',
    );
    expect(result.answer).toContain("data, not instructions");
    // The owner still writes into their own session.
    expect(
      (
        await gateway.sessions.submit(actor, {
          eventId: "owner-2",
          text: "Thanks.",
          sessionId: owner.sessionId,
        })
      ).sessionId,
    ).toBe(owner.sessionId);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});
