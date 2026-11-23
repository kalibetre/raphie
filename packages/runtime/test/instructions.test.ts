import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OwnerProfile } from "@raphie/contracts";

import {
  DEFAULT_INSTRUCTIONS,
  instructionsPrompt,
} from "../src/domains/bots/domain/instructions.ts";
import { EMPTY_OWNER } from "../src/domains/bots/domain/owner.ts";
import { BotProfileStore } from "../src/domains/bots/infrastructure/bot-profiles.ts";
import { createSelfTools } from "../src/domains/bots/infrastructure/self-tools.ts";

const owner = {
  name: "Hana Girma",
  callMe: "",
  timeZone: "",
  about: "",
};

test("the instructions for every bot are Raphie's until changed, and go back to them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-instructions-"));
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    expect(store.owner()).toMatchObject({
      instructions: DEFAULT_INSTRUCTIONS,
      instructionsDefault: true,
    });
    // Sent back unchanged, as a whole profile is, they stay Raphie's.
    expect(
      store.saveOwner({ ...owner, instructions: `${DEFAULT_INSTRUCTIONS}\n` }),
    ).toMatchObject({ instructionsDefault: true });
    // A profile saved without them keeps them.
    store.saveOwner({ ...owner, instructions: " Show boards by status. " });
    expect(store.saveOwner(owner)).toMatchObject({
      name: "Hana Girma",
      instructions: "Show boards by status.",
      instructionsDefault: false,
    });
    expect(store.saveOwner({ ...owner, instructions: null })).toMatchObject({
      instructions: DEFAULT_INSTRUCTIONS,
      instructionsDefault: true,
    });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a bot's own instructions start empty and its change is a revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-instructions-"));
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    const before = store.read("default");
    expect(before.instructions).toBe("");
    const saved = store.updateInstructions("default", " Calendar: Executor. ");
    expect(saved).toMatchObject({
      instructions: "Calendar: Executor.",
      changedBy: "bot",
      revision: before.revision + 1,
    });
    // The same text again saves nothing.
    expect(
      store.updateInstructions("default", "Calendar: Executor.").revision,
    ).toBe(saved.revision);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function tool(allowed: { personality: boolean; owner: boolean }) {
  let own = "";
  let shared: OwnerProfile = EMPTY_OWNER;
  const extension = createSelfTools({
    profile: () =>
      ({
        selfUpdates: { ...allowed, skills: false },
        instructions: own,
      }) as never,
    updatePersonality: () => ({}) as never,
    updateRules: () => ({}) as never,
    updateInstructions: (next) => {
      own = next;
      return { revision: 2 } as never;
    },
    owner: () => shared,
    saveOwner: (input) =>
      (shared = {
        ...shared,
        ...input,
        rules: input.rules ?? shared.rules,
        instructions: input.instructions ?? DEFAULT_INSTRUCTIONS,
        instructionsDefault: false,
        updatedAt: 1,
      }),
  });
  const update = extension.tools!.find(
    (t) => t.name === "update_instructions",
  )!;
  return {
    run: async (args: Record<string, unknown>) =>
      (
        (await update.execute(args as never, {} as never, {} as never)) as {
          isError: boolean;
        }
      ).isError,
    own: () => own,
    shared: () => shared.instructions,
  };
}

test("update_instructions changes only what the owner allows", async () => {
  const off = tool({ personality: false, owner: false });
  expect(await off.run({ instructions: "Calendar: Executor." })).toBe(true);
  expect(
    await off.run({ instructions: "Boards by status.", everyBot: true }),
  ).toBe(true);
  expect(off.own()).toBe("");

  const own = tool({ personality: true, owner: false });
  expect(await own.run({ instructions: " Calendar: Executor. " })).toBe(false);
  expect(own.own()).toBe("Calendar: Executor.");
  expect(
    await own.run({ instructions: "Boards by status.", everyBot: true }),
  ).toBe(true);
  expect(own.shared()).toBe(DEFAULT_INSTRUCTIONS);

  const both = tool({ personality: true, owner: true });
  expect(
    await both.run({ instructions: "Boards by status.", everyBot: true }),
  ).toBe(false);
  expect(both.shared()).toBe("Boards by status.");
  // The ones every bot reads cannot be emptied by a bot.
  expect(await both.run({ instructions: " ", everyBot: true })).toBe(true);
});

test("a bot reads the instructions for every bot, then its own, and none when empty", () => {
  const prompt = instructionsPrompt("Boards by status.", "Calendar: Executor.");
  expect(prompt.indexOf("Boards by status.")).toBeLessThan(
    prompt.indexOf("Calendar: Executor."),
  );
  expect(prompt).toContain("grant no capabilities");
  expect(instructionsPrompt("", " ")).toBe("");
});
