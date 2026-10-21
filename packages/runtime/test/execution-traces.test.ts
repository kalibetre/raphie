import { test } from "bun:test";
import assert from "node:assert/strict";

import { ExecutionTraces } from "../src/domains/conversations/infrastructure/pi-execution-traces.ts";
import {
  noTelemetry,
  type TraceAttributes,
} from "../src/shared/application/telemetry.ts";

test("retry wait is separate from model work and shutdown never reports incomplete work as successful", () => {
  const ended: {
    name: string;
    attributes: TraceAttributes;
    outcome: string;
  }[] = [];
  const telemetry = {
    ...noTelemetry,
    start(name: string, attributes: TraceAttributes) {
      let count = 0;
      return {
        annotate: () => {},
        end(outcome = "ok") {
          assert.equal(
            ++count,
            1,
            "Each observed span must settle exactly once",
          );
          ended.push({ name, attributes, outcome });
        },
      };
    },
  };
  const traces = new ExecutionTraces(telemetry, { "session.id": "session" });
  traces.accept({ type: "run_start", inputs: [] }, "turn");
  traces.accept({ type: "turn_start" });
  traces.accept({
    type: "auto_retry_start",
    attempt: 1,
    at: Date.now(),
    errorMessage: "PRIVATE_ERROR",
  });
  assert.equal(ended[0]?.name, "model.generate");
  assert.equal(ended[0]?.outcome, "error");
  traces.accept({ type: "auto_retry_end", attempt: 1 });
  assert.equal(ended[1]?.name, "model.retry");
  assert.equal(ended[1]?.outcome, "ok");
  traces.close();
  traces.close();
  assert.equal(ended[2]?.name, "model.generate");
  assert.equal(ended[2]?.attributes["model.attempt"], 2);
  assert.equal(ended[2]?.outcome, "interrupted");
  assert.equal(ended[3]?.name, "agent.run");
  assert.equal(ended[3]?.outcome, "interrupted");
  assert.equal(ended[3]?.attributes["turn.id"], "turn");
  assert.equal(ended.length, 4);
  assert.equal(JSON.stringify(ended).includes("PRIVATE_ERROR"), false);
});
