import { expect, test } from "bun:test";

import type { SessionSummary } from "@raphie/contracts";

import {
  byNewReplies,
  titleMatches,
} from "../src/domains/conversations/application/session-summaries";

const session = (id: string, title = id) => ({ id, title }) as SessionSummary;

test("conversations with new replies come first, each group in its order", () => {
  const sessions = ["a", "b", "c", "d"].map((id) => session(id));
  const unread = (s: SessionSummary) => (s.id === "b" || s.id === "d" ? 1 : 0);
  expect(byNewReplies(sessions, unread).map((s) => s.id)).toEqual([
    "b",
    "d",
    "a",
    "c",
  ]);
});

test("a title search ignores case and surrounding spaces", () => {
  expect(titleMatches(session("1", "Plan the Week"), "  week ")).toBe(true);
  expect(titleMatches(session("1", "Plan the Week"), "month")).toBe(false);
});
