import { test } from "bun:test";
import assert from "node:assert/strict";

import { replyFailure } from "../src/domains/conversations/domain/failure.ts";

test("a failed reply says why in plain words and keeps the provider's message", () => {
  assert.deepEqual(replyFailure("model_error", "429 Too Many Requests"), {
    message: "The model returned an error.",
    detail: "429 Too Many Requests",
  });
  assert.equal(
    replyFailure("turn_limit").message,
    "The bot used its limit of tool rounds for one reply. Send a message to let it carry on.",
  );
  // An unknown reason still names itself rather than saying nothing.
  assert.equal(
    replyFailure("something_new").message,
    "The reply ended without an answer (something_new).",
  );
  // Structured details give their message; empty ones are left out.
  assert.equal(
    replyFailure("faulted", { message: "disk full" }).detail,
    "disk full",
  );
  assert.equal(replyFailure("model_error", "  ").detail, undefined);
  // A long error is cut, and anything shaped like a key is masked.
  assert.equal(
    replyFailure("model_error", "x".repeat(5000)).detail?.length,
    1001,
  );
  assert.equal(
    replyFailure(
      "model_error",
      "Incorrect API key provided: sk-proj-abcdefghijklmnop. Header was Bearer abcdefghijklmnop",
    ).detail,
    "Incorrect API key provided: sk-…. Header was Bearer …",
  );
});
