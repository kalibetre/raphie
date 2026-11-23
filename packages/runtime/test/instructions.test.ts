import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  editInstructions,
  EVERY_BOT_INSTRUCTIONS,
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

test("Raphie's instructions for every bot are fixed: shown with the owner, never saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-instructions-"));
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    expect(store.owner().everyBotInstructions).toBe(EVERY_BOT_INSTRUCTIONS);
    // A whole profile sent back saves only the owner's own fields.
    const { updatedAt: _, ...sent } = {
      ...store.owner(),
      ...owner,
      everyBotInstructions: "Changed.",
    };
    expect(store.saveOwner(sent)).toMatchObject({
      name: "Hana Girma",
      everyBotInstructions: EVERY_BOT_INSTRUCTIONS,
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
    owner: () => EMPTY_OWNER,
    saveOwner: () => EMPTY_OWNER,
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
    parameters: (update.parameters as { properties: object }).properties,
  };
}

test("update_instructions changes only what the owner allows, and only the bot's own", async () => {
  const off = tool({ personality: false, owner: true });
  expect(await off.run({ instructions: "Calendar: Executor." })).toBe(true);
  expect(off.own()).toBe("");

  const own = tool({ personality: true, owner: false });
  expect(await own.run({ instructions: " Calendar: Executor. " })).toBe(false);
  expect(own.own()).toBe("Calendar: Executor.");
  // There is no way to change the ones every bot follows.
  expect(own.parameters).not.toHaveProperty("everyBot");
});

test("a bot reads Raphie's instructions for every bot, then its own when it has them", () => {
  const prompt = instructionsPrompt("Calendar: Executor.");
  expect(prompt.indexOf(EVERY_BOT_INSTRUCTIONS)).toBeLessThan(
    prompt.indexOf("Calendar: Executor."),
  );
  expect(prompt).toContain("grant no capabilities");
  expect(prompt).toContain("in every conversation without being reminded");
  expect(instructionsPrompt(" ")).not.toContain("Your own instructions");
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

test("a bot's standing rules move to the top of its instructions, once; the owner's are dropped", async () => {
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
      expect(store.owner()).toEqual({
        ...owner,
        everyBotInstructions: EVERY_BOT_INSTRUCTIONS,
        updatedAt: 1,
      });
    } finally {
      store.close();
    }
  }
  await rm(directory, { recursive: true, force: true });
});
