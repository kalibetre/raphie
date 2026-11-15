import { expect, test } from "bun:test";

import type { SessionSummary } from "@raphie/contracts";

import {
  mergeReplyLedgers,
  parseReplyLedger,
  readCount,
  readReplies,
  unreadReplies,
} from "../src/domains/conversations/application/reply-ledger";

const session = { sessionId: "same-id", replyCount: 3 } as SessionSummary;
test("concurrent tabs merge read cursors monotonically across conversations and bots", () => {
  const a = { default: { first: 2 }, research: { first: 1 } };
  const b = { default: { first: 1, second: 4 } };
  const merged = mergeReplyLedgers(a, b);
  expect(merged).toEqual({
    default: { first: 2, second: 4 },
    research: { first: 1 },
  });
  expect(JSON.stringify(merged)).toBe(JSON.stringify(mergeReplyLedgers(b, a)));
});
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
test("replies read in another client count as read here too", () => {
  const ledger = readReplies({}, "default", session.sessionId, 1);
  // Another client read two; the runtime says so.
  const shared = { ...session, readReplyCount: 2 };
  expect(readCount(ledger, "default", shared)).toBe(2);
  expect(unreadReplies(ledger, "default", shared)).toBe(1);
  // Reading further here wins over a runtime that has heard less.
  const ahead = readReplies(ledger, "default", session.sessionId, 3);
  expect(unreadReplies(ahead, "default", shared)).toBe(0);
  // An older runtime without the field leaves this browser's cursor alone.
  expect(readCount(ledger, "default", session)).toBe(1);
});
