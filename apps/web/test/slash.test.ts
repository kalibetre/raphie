import { expect, test } from "bun:test";

import {
  insertSkill,
  leadingSkill,
  type SlashItem,
  slashMatches,
  slashQuery,
} from "../src/domains/conversations/application/slash";

const items: SlashItem[] = [
  { kind: "command", name: "new", description: "Start a new conversation" },
  { kind: "command", name: "model", description: "Choose the model" },
  { kind: "skill", name: "weekly-report", description: "Report." },
];

test("the / menu opens only for the first word of the draft", () => {
  expect(slashQuery("/", 1)).toBe("");
  expect(slashQuery("/we", 3)).toBe("we");
  expect(slashQuery("/WE", 3)).toBe("we");
  // After a space, or anywhere but the start, a / is just text.
  expect(slashQuery("/weekly-report now", 18)).toBeNull();
  expect(slashQuery("see /tmp", 8)).toBeNull();
  expect(slashQuery("", 0)).toBeNull();
  expect(slashQuery(" /new", 5)).toBeNull();
});

test("matches start with what was typed, commands first", () => {
  expect(slashMatches(items, "").map((i) => i.name)).toEqual([
    "new",
    "model",
    "weekly-report",
  ]);
  expect(slashMatches(items, "w").map((i) => i.name)).toEqual([
    "weekly-report",
  ]);
  expect(slashMatches(items, "zzz")).toEqual([]);
});

test("choosing a skill writes /name and keeps what followed", () => {
  expect(insertSkill("/we", "weekly-report")).toEqual({
    text: "/weekly-report ",
    caret: 15,
  });
  expect(insertSkill("/we for the team", "weekly-report").text).toBe(
    "/weekly-report for the team",
  );
});

test("a message's leading skill is found as the runtime reads it", () => {
  const skills = ["weekly-report"];
  expect(leadingSkill("/weekly-report for the team", skills)).toEqual({
    name: "weekly-report",
    typed: "/weekly-report",
    rest: " for the team",
  });
  expect(leadingSkill("/weekly_report", skills)?.name).toBe("weekly-report");
  expect(leadingSkill("/tmp is full", skills)).toBeNull();
  expect(leadingSkill("see /weekly-report", skills)).toBeNull();
});
