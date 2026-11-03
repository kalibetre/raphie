import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

test("steering during a text reply preserves the next run's distinct answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-steer-text-"));
  const pause = Promise.withResolvers<void>();
  let calls = 0;
  const app = await Gateway.open({
    directory,
    ...chatModel({ pause: pause.promise, started: () => calls++ }),
  });
  const actor = app.actors.establish("web");
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await delay(10);
    }
    throw new Error("Timed out waiting for durable state");
  };
  try {
    const first = await app.sessions.submit(actor, {
      eventId: "original",
      text: "Original",
    });
    await until(async () => calls === 1);
    for (const text of ["Correction", "Another correction"]) {
      const turn = await app.sessions.submit(actor, {
        eventId: text,
        text,
        sessionId: first.sessionId,
      });
      await until(async () =>
        (await app.chats.state()).turns.some(
          (t) => t.id === turn.id && !!t.queueMode,
        ),
      );
      await app.sessions.control(actor, first.sessionId, "steer", turn.id);
    }
    pause.resolve();
    await until(async () =>
      (await app.chats.state()).turns.every((t) => t.status === "done"),
    );
    assert.equal(calls, 3);
    const history = await app.queries.history(actor, first.sessionId);
    assert.deepEqual(
      history.items.flatMap((t) => (t.answer === null ? [] : [t.answer])),
      [
        "Original",
        "Original | Correction",
        "Original | Correction | Another correction",
      ],
    );
    assert.equal(
      (await app.queries.sessions(actor)).items.find(
        (s) => s.id === first.sessionId,
      )?.replyCount,
      3,
    );
  } finally {
    pause.resolve();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("queued messages can steer or remain queued, and stopping retires work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-control-"));
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: { name: "mcp_fixture_execute", args: { code: "exact()" } },
    }),
    mcp: {
      identity: "fixture",
      client: {
        server: { name: "fixture", version: "1" },
        tools: [
          {
            name: "execute",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        ],
        call: async () => ({ content: [{ type: "text", text: "done" }] }),
        close: async () => {},
      },
    },
  });
  const actor = app.actors.establish("web");
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await delay(10);
    }
    throw new Error("Timed out waiting for durable state");
  };
  try {
    const first = await app.sessions.submit(actor, {
      eventId: "first",
      text: "Start",
    });
    await until(
      async () => !!(await app.toolApprovals.state()).approvals.length,
    );
    const second = await app.sessions.submit(actor, {
      eventId: "second",
      text: "Change direction",
      sessionId: first.sessionId,
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === second.id)
          ?.queueMode === "followUp",
    );
    assert.equal(
      (await app.queries.history(actor, first.sessionId)).items.find(
        (t) => t.id === second.id,
      )?.queueMode,
      "followUp",
    );
    await app.sessions.control(actor, first.sessionId, "steer", second.id);
    assert.equal(
      (await app.chats.state()).turns.find((t) => t.id === second.id)
        ?.queueMode,
      "steer",
    );
    await app.sessions.control(actor, first.sessionId, "queue", second.id);
    assert.equal(
      (await app.chats.state()).turns.find((t) => t.id === second.id)
        ?.queueMode,
      "followUp",
    );
    await app.sessions.control(actor, first.sessionId, "stop");
    await until(async () =>
      (await app.chats.state()).turns.every((t) => t.status !== "pending"),
    );
    assert.ok((await app.chats.state()).turns.every((t) => t.cancelled));
    assert.ok(
      (await app.toolApprovals.state()).approvals.every(
        (a) => a.status !== "pending",
      ),
    );
    assert.equal(
      (await app.queries.sessions(actor)).items.find(
        (s) => s.id === first.sessionId,
      )?.failed,
      false,
    );
    const next = await app.sessions.submit(actor, {
      eventId: "next",
      text: "Another task",
    });
    await until(async () =>
      (await app.toolApprovals.state()).approvals.some(
        (a) => a.status === "pending",
      ),
    );
    const correction = await app.sessions.submit(actor, {
      eventId: "correction",
      text: "Use this correction",
      sessionId: next.sessionId,
    });
    await until(
      async () =>
        !!(await app.chats.state()).turns.find((t) => t.id === correction.id)
          ?.queueMode,
    );
    await app.sessions.control(actor, next.sessionId, "steer", correction.id);
    const additional = await app.sessions.submit(actor, {
      eventId: "additional-correction",
      text: "One more correction",
      sessionId: next.sessionId,
    });
    await until(async () =>
      (await app.chats.state()).turns.some(
        (t) => t.id === additional.id && !!t.queueMode,
      ),
    );
    await app.sessions.control(actor, next.sessionId, "steer", additional.id);
    const approval = (await app.toolApprovals.state()).approvals.find(
      (a) => a.status === "pending",
    )!;
    await app.sessions.decide(actor, approval.id, "approved");
    const turnIds = new Set([next.id, correction.id, additional.id]);
    await until(async () =>
      (await app.chats.state()).turns
        .filter((t) => turnIds.has(t.id))
        .every((t) => t.status === "done"),
    );
    const completed = (await app.chats.state()).turns.filter((t) =>
      turnIds.has(t.id),
    );
    // The first correction shares the tool run's answer; the next starts a
    // distinct run. Both return "done", so text equality cannot deduplicate.
    assert.deepEqual(
      completed.flatMap((t) => (t.answer === null ? [] : [t.answer])),
      ["done", "done"],
    );
    assert.equal(completed[0]!.answerEntryId, completed[1]!.answerEntryId);
    assert.notEqual(completed[1]!.answerEntryId, completed[2]!.answerEntryId);
    assert.ok(completed.every((t) => !t.queueMode));
    await assert.rejects(
      app.sessions.control(actor, first.sessionId, "steer", second.id),
      /already been picked up/,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
