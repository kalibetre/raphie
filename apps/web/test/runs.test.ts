import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  activeRunLabel,
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
  assert.equal(activeRunLabel(live, [], []), "Writing reply…");
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
