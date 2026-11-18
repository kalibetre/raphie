import { test } from "bun:test";
import assert from "node:assert/strict";

import { stepState } from "../src/domains/approvals/presentation/tool-steps.tsx";
import type { ToolStep } from "../src/domains/conversations/application/run-projection.ts";
import type { Approval } from "../src/infrastructure/http/api-client.ts";

test("a step whose end the journal missed stops running once the reply is finished", () => {
  const step: ToolStep = { id: "t1", tool: "search", startedAt: 1 };
  assert.equal(stepState(step, true), "running");
  assert.equal(stepState(step, false), "done");
  const approved = {
    ...step,
    approval: { id: "ap1", status: "approved", expiresAt: 0 } as Approval,
  };
  assert.equal(stepState(approved, true), "running");
  assert.equal(stepState(approved, false), "done");
  // The owner's decision still comes first.
  const pending = {
    ...step,
    approval: {
      id: "ap2",
      status: "pending",
      expiresAt: Date.now() + 60_000,
    } as Approval,
  };
  assert.equal(stepState(pending, false), "pending");
});
