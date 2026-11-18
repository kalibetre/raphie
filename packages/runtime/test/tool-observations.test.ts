import { test } from "bun:test";
import assert from "node:assert/strict";

import type { LiveState } from "@earendil-works/pi-durable";

import { Observations } from "../src/domains/conversations/infrastructure/pi-observations.ts";
import type { DurableContext } from "../src/shared/infrastructure/durable-context.ts";

const live = (
  tools: Array<{ callId: string; name: string; status: string }>,
  nestedTools: typeof tools = [],
) => ({ tools, nestedTools }) as unknown as LiveState;

test("a tool call that leaves the live state while running is recorded as settled", () => {
  const observations = new Observations({} as DurableContext);
  const rows = (previous: LiveState | undefined, next: LiveState | undefined) =>
    observations["activityRows"](previous, next).map(
      (row) => `${row.type} ${row.operationId}`,
    );
  const caller = { callId: "c1", name: "mcp_executor_call", status: "running" };
  const nested = { callId: "n1", name: "search", status: "running" };

  // A nested call goes with its caller, never seen done.
  assert.deepEqual(
    rows(live([caller], [nested]), live([{ ...caller, status: "done" }])),
    ["tool.completed c1", "tool.completed n1"],
  );
  // Updates merged over a call's whole life: gone between two looks.
  assert.deepEqual(rows(live([caller]), undefined), ["tool.completed c1"]);
  // A call seen done is recorded once, not again when it leaves.
  assert.deepEqual(rows(live([{ ...caller, status: "done" }]), live([])), []);
  // A call still waiting to start has not run, so it is not settled.
  assert.deepEqual(
    rows(live([{ ...caller, status: "pending" }]), live([])),
    [],
  );
});
