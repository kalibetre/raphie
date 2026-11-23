import { expect, test } from "bun:test";

import type { BotProfile } from "@raphie/contracts";

import {
  ownerSaved,
  personalityEdit,
  selfUpdateNotes,
} from "../src/domains/conversations/application/self-updates";

const step = (id: string, tool: string, done = true) => ({
  id,
  tool,
  startedAt: 10_000,
  doneAt: done ? 10_500 : undefined,
});

test("only finished self-updates become notes", () => {
  expect(
    selfUpdateNotes([
      step("a", "update_personality"),
      step("b", "update_owner_profile"),
      step("c", "update_owner_profile", false),
      step("d", "read_skill"),
      { ...step("e", "update_personality"), server: "evil" },
      step("f", "save_skill"),
      { ...step("g", "save_skill"), server: "evil" },
    ]).map((note) => [note.id, note.kind]),
  ).toEqual([
    ["a", "personality"],
    ["b", "owner"],
    ["f", "skill"],
  ]);
});

const [note] = selfUpdateNotes([step("a", "update_personality")]);

test("a personality edit is the bot's revision saved during the step, undone to the one before", () => {
  const revision = (n: number, updatedAt: number, changedBy?: "bot") =>
    ({ revision: n, updatedAt, changedBy }) as BotProfile;
  const history = [
    revision(4, 90_000, "bot"),
    revision(3, 10_200, "bot"),
    revision(2, 5_000),
    revision(1, 1_000),
  ];
  expect(personalityEdit(history, note!)).toEqual({
    edit: history[1],
    before: history[2],
  });
  // Not allowed: nothing saved while the step ran.
  expect(personalityEdit([revision(1, 1_000)], note!)).toBeUndefined();
});

test("an owner note holds only while the profile is as the bot saved it", () => {
  const owner = {
    name: "Hana Girma",
    callMe: "Hana",
    timeZone: "Africa/Addis_Ababa",
    about: "",
    rules: [],
    instructions: "",
    instructionsDefault: false,
    updatedAt: 10_300,
  };
  expect(ownerSaved(owner, note!)).toBe(true);
  expect(ownerSaved({ ...owner, updatedAt: 60_000 }, note!)).toBe(false);
  expect(ownerSaved({ ...owner, updatedAt: null }, note!)).toBe(false);
});
