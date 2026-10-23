import { expect, test } from "bun:test";

import type { SessionSummary } from "@raphie/contracts";

import {
  parseReplyLedger,
  readReplies,
  unreadReplies,
} from "../src/domains/conversations/application/reply-ledger";

const session = { sessionId: "same-id", replyCount: 3 } as SessionSummary;
test("unread replies count completed responses and stay scoped to their bot", () => {
  const ledger = readReplies({}, "default", session.sessionId, 2);
  expect(unreadReplies(ledger, "default", session)).toBe(1);
  expect(unreadReplies(ledger, "research", session)).toBe(3);
  expect(readReplies(ledger, "default", session.sessionId, 1)).toBe(ledger);
  expect(
    unreadReplies(ledger, "default", { ...session, replyCount: undefined }),
  ).toBe(0);
});
test("stored reply cursors reject corrupt values and cannot create negative unread counts", () => {
  expect(parseReplyLedger("not JSON")).toEqual({});
  const ledger = parseReplyLedger(
    '{"default":{"same-id":4,"bad":"3","negative":-1,"fraction":1.2}}',
  );
  expect(ledger).toEqual({ default: { "same-id": 4 } });
  expect(unreadReplies(ledger, "default", session)).toBe(0);
});
