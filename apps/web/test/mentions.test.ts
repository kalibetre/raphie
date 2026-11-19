import { expect, test } from "bun:test";

import {
  insertMention,
  mentionMatches,
  mentionQuery,
} from "../src/domains/conversations/application/mentions";

const bots = [
  { id: "r", name: "Research" },
  { id: "c", name: "Chief of staff" },
  { id: "w", name: "Writer" },
];

test("an @ opens a mention only at a word's start, up to the caret", () => {
  expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  expect(mentionQuery("Ask @Res", 8)).toEqual({ start: 4, query: "Res" });
  expect(mentionQuery("Ask @Chief of", 13)).toEqual({
    start: 4,
    query: "Chief of",
  });
  // An email address, a line break or no @ is not a mention.
  expect(mentionQuery("mail me@home", 12)).toBeNull();
  expect(mentionQuery("@Res\nmore", 9)).toBeNull();
  expect(mentionQuery("plain text", 10)).toBeNull();
  // Only what is before the caret counts.
  expect(mentionQuery("Ask @Research to", 6)).toEqual({ start: 4, query: "R" });
});

test("matches are bots whose names start with what was typed", () => {
  expect(mentionMatches(bots, "").map((b) => b.id)).toEqual(["r", "c", "w"]);
  expect(mentionMatches(bots, "re").map((b) => b.id)).toEqual(["r"]);
  expect(mentionMatches(bots, "chief o").map((b) => b.id)).toEqual(["c"]);
  expect(mentionMatches(bots, "zz")).toEqual([]);
});

test("choosing a bot completes its name and moves the caret past it", () => {
  const text = "Ask @Res about snapshots";
  expect(
    insertMention(text, { start: 4, query: "Res" }, 8, "Research"),
  ).toEqual({ text: "Ask @Research about snapshots", caret: 14 });
  expect(insertMention("@", { start: 0, query: "" }, 1, "Writer")).toEqual({
    text: "@Writer ",
    caret: 8,
  });
});
