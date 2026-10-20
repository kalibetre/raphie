import { test } from "bun:test";
import assert from "node:assert/strict";

import { decideApproval } from "../src/domains/approvals/domain/decision.ts";
import { attachmentName } from "../src/domains/attachments/domain/policy.ts";
import { messageViolation } from "../src/domains/conversations/domain/admission.ts";

test("settled approvals are immutable and expiry wins at its boundary", () => {
  assert.equal(decideApproval("approved", 100, "rejected", 200), "approved");
  assert.equal(decideApproval("rejected", 100, "approved", 50), "rejected");
  assert.equal(decideApproval("pending", 100, "approved", 100), "expired");
  assert.equal(decideApproval("pending", 100, "approved", 99), "approved");
});
test("message admission and display names reject unsafe input", () => {
  assert.equal(
    messageViolation({ eventId: "evt", text: "Hello", conversationId: 1 }),
    undefined,
  );
  assert.ok(messageViolation({ eventId: "evt", text: "   " }));
  assert.ok(
    messageViolation({ eventId: "evt", text: "Hello", conversationId: -1 }),
  );
  assert.equal(attachmentName("../../notes.txt"), "notes.txt");
  assert.equal(attachmentName("C:\\notes\\file.txt"), "file.txt");
  assert.equal(attachmentName("\0\n"), "attachment");
});
