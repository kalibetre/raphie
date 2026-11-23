import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OwnerProfile } from "@raphie/contracts";

import {
  DEFAULT_INSTRUCTIONS,
  editInstructions,
  instructionsPrompt,
  withRules,
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
    updateInstructions: (next) => {
      own = next;
      return { revision: 2 } as never;
    },
    owner: () => shared,
    saveOwner: (input) =>
      (shared = {
        ...shared,
        ...input,
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
  expect(prompt).toContain("in every conversation without being reminded");
  expect(instructionsPrompt("", " ")).toBe("");
});

test("a bot adds to its instructions and replaces one passage, leaving the rest", async () => {
  const bot = tool({ personality: true, owner: true });
  expect(await bot.run({ add: "- Give times on a 12-hour clock." })).toBe(
    false,
  );
  expect(await bot.run({ add: "- Fizzy is my task board." })).toBe(false);
  expect(bot.own()).toBe(
    "- Give times on a 12-hour clock.\n- Fizzy is my task board.",
  );
  expect(
    await bot.run({
      replace: "Fizzy is my task board.",
      with: "Fizzy is my task board; show it by column.",
    }),
  ).toBe(false);
  expect(await bot.run({ replace: "- Give times on a 12-hour clock." })).toBe(
    false,
  );
  expect(bot.own()).toBe("- Fizzy is my task board; show it by column.");
  // Text that is not there, or two changes at once, is refused.
  expect(await bot.run({ replace: "Never use cards.", with: "x" })).toBe(true);
  expect(await bot.run({ add: "x", instructions: "y" })).toBe(true);
  expect(await bot.run({})).toBe(true);
  // An addition for every bot goes after Raphie's own.
  expect(await bot.run({ add: "## Boards\nBy column.", everyBot: true })).toBe(
    false,
  );
  expect(bot.shared()).toBe(`${DEFAULT_INSTRUCTIONS}\n## Boards\nBy column.`);
});

test("an edit says why it cannot be made", () => {
  expect(editInstructions("a\na", { replace: "a", with: "b" })).toEqual({
    problem:
      "That text is in the instructions more than once. Give enough of it to tell which.",
  });
  expect("problem" in editInstructions("", { add: "x".repeat(16_001) })).toBe(
    true,
  );
  expect(
    editInstructions("one\n\ntwo\n\nthree", { replace: "two", with: "" }),
  ).toEqual({ text: "one\n\nthree" });
});

test("standing rules saved before move to the top of the instructions, once", async () => {
  expect(
    withRules("Calendar: Executor.", ["* Be  brief.", "Be brief.", " "]),
  ).toBe("## Rules\n- Be brief.\n\nCalendar: Executor.");
  expect(withRules("Same.", [])).toBe("Same.");

  const directory = await mkdtemp(join(tmpdir(), "raphie-instructions-"));
  const path = join(directory, "bots.sqlite");
  new BotProfileStore(path).close();
  // As an older runtime left them: rules beside the profile and the owner.
  const db = new Database(path);
  db.query(
    "UPDATE bot_profiles SET value=json_set(value,'$.rules',json('[\"Link every source.\"]')) WHERE id='default'",
  ).run();
  db.query("INSERT INTO owner_profile(id,value) VALUES(1,?)").run(
    JSON.stringify({
      ...owner,
      rules: ["Give times on a 12-hour clock."],
      updatedAt: 1,
    }),
  );
  db.close();
  for (let open = 0; open < 2; open++) {
    const store = new BotProfileStore(path);
    try {
      expect(store.read("default").instructions).toBe(
        "## Rules\n- Link every source.",
      );
      expect(store.owner()).toMatchObject({
        name: "Hana Girma",
        instructions: `## Rules\n- Give times on a 12-hour clock.\n\n${DEFAULT_INSTRUCTIONS}`,
        instructionsDefault: false,
      });
      expect(store.owner()).not.toHaveProperty("rules");
    } finally {
      store.close();
    }
  }
  await rm(directory, { recursive: true, force: true });
});
