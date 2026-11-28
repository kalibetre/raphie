import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  activeRunLabel,
  contextTokens,
  formatTokens,
  runUsage,
  toolSteps,
} from "../src/domains/conversations/application/run-projection.ts";
import type {
  ActivityEvent,
  Approval,
} from "../src/infrastructure/http/api-client.ts";

let id = 0;
const event = (
  type: string,
  runId: string | null,
  operationId: string | null,
  summary = type,
  detailsJson = "{}",
) =>
  ({
    id: ++id,
    at: id,
    type,
    runId,
    operationId,
    summary,
    detailsJson,
  }) as unknown as ActivityEvent;

test("pending activity distinguishes model output, tool execution, and the next model wait", () => {
  const live = { generating: true, text: "I’ll check that." };
  const start = event(
    "tool.started",
    "run",
    "tool",
    "mcp_calendar_list started",
  );
  const steps = toolSteps("run", [start], []);
  assert.equal(activeRunLabel(live, [], []), "Writing…");
  assert.equal(
    activeRunLabel({ generating: false, text: live.text }, [], []),
    "Waiting for model…",
  );
  assert.equal(
    activeRunLabel(live, steps, [start]),
    "Running calendar · list…",
  );
  assert.equal(
    activeRunLabel({ generating: false, text: live.text }, steps, [
      start,
      event("tool.completed", "run", "tool"),
    ]),
    "Waiting for model…",
  );
  assert.equal(
    activeRunLabel(undefined, [], [event("model.retry", "run", null)]),
    "Retrying model…",
  );
});

test("a summary the reply waits for shows, and one in the background does not", () => {
  const waiting = { generating: false, text: "" };
  const blocking = (type: string) =>
    event(type, "run", "task", type, JSON.stringify({ blocking: true }));
  const background = (type: string) =>
    event(type, "run", "task", type, JSON.stringify({ blocking: false }));
  const start = event("tool.started", "run", "tool", "search started");
  const steps = toolSteps("run", [start], []);
  assert.equal(
    activeRunLabel(waiting, [], [blocking("compaction.started")]),
    "Summarizing earlier messages…",
  );
  assert.equal(
    activeRunLabel(
      waiting,
      [],
      [blocking("compaction.started"), blocking("compaction.completed")],
    ),
    "Waiting for model…",
  );
  assert.equal(
    activeRunLabel(waiting, steps, [start, background("compaction.started")]),
    "Running search…",
  );
});

test("tool steps join the journal with approvals and post-decision results", () => {
  const approval = { id: "ap1", status: "approved" } as Approval;
  const steps = toolSteps(
    "run",
    [
      event(
        "tool.started",
        "run",
        "t1",
        "mcp_executor_skills started",
        '{"name":"x"}',
      ),
      event("tool.completed", "run", "t1"),
      event("tool.started", "run", "t2", "mcp_executor_execute started"),
      event("approval.requested", "run", "ap1"),
      event("action.completed", null, "ap1", "done", '{"text":"result"}'),
      event("tool.started", "other", "t3", "mcp_executor_resume started"),
    ],
    [approval],
  );
  assert.deepEqual(
    steps.map((s) => [s.server, s.tool, !!s.doneAt, s.approval?.id, s.result]),
    [
      ["executor", "skills", true, undefined, undefined],
      ["executor", "execute", false, "ap1", "result"],
    ],
  );
  assert.equal(steps[0].args, '{"name":"x"}');
});

test("a saved connection's tools are named for it, not for its namespace", () => {
  const steps = toolSteps(
    "run",
    [
      event(
        "tool.started",
        "run",
        "t1",
        "mcp_c_f382d156e9b74bbe85a947e01f779a98_t3_thread_list started",
      ),
    ],
    [],
  );
  assert.deepEqual(
    steps.map((s) => [s.connection, s.server, s.tool]),
    [["f382d156-e9b7-4bbe-85a9-47e01f779a98", undefined, "t3_thread_list"]],
  );
});

test("a running step can be put in words", () => {
  const start = event(
    "tool.started",
    "run",
    "tool",
    "mcp_calendar_list started",
  );
  const steps = toolSteps("run", [start], []);
  assert.equal(
    activeRunLabel(undefined, steps, [start], () => "Checking Calendar"),
    "Checking Calendar…",
  );
});

test("run usage sums provider-reported tokens and cost per run", () => {
  const usage = (tokens: number, cost: number) =>
    JSON.stringify({ usage: { totalTokens: tokens, cost: { total: cost } } });
  const activity = [
    event("model.completed", "run", null, "", usage(100, 0.001)),
    event("model.completed", "run", null, "", usage(50, 0.002)),
    event("model.completed", "other", null, "", usage(999, 1)),
  ];
  assert.deepEqual(runUsage("run", activity), {
    tokens: 150,
    cost: 0.003,
    calls: 2,
  });
  assert.equal(runUsage("missing", activity), undefined);
});

test("the context ring reads the conversation's latest model call", () => {
  const usage = (totalTokens: number) =>
    JSON.stringify({ usage: { totalTokens } });
  const activity = [
    event("model.completed", "run-1", null, "first", usage(1200)),
    event("model.completed", "run-1", null, "second", usage(3400)),
    event(
      "model.completed",
      "other",
      null,
      "another conversation",
      usage(9000),
    ),
    event("model.completed", "run-2", null, "latest", usage(5100)),
    event("run.completed", "run-2", null),
  ];
  assert.equal(contextTokens(["run-1", "run-2"], activity), 5100);
  assert.equal(contextTokens(["run-1"], activity), 3400);
  assert.equal(contextTokens(["none"], activity), undefined);
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(1_048_576), "1M");
  assert.equal(formatTokens(200_000), "200k");
});
