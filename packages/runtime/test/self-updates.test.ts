import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OwnerProfile, PersonalityPreset } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import {
  EMPTY_OWNER,
  selfUpdateInstructions,
} from "../src/domains/bots/domain/owner.ts";
import { PERSONALITY_PRESETS } from "../src/domains/bots/domain/personalities.ts";
import {
  MAX_RULES,
  rulesInstructions,
} from "../src/domains/bots/domain/rules.ts";
import { BotProfileStore } from "../src/domains/bots/infrastructure/bot-profiles.ts";
import { createSelfTools } from "../src/domains/bots/infrastructure/self-tools.ts";
import { chatModel } from "./chat-model.ts";

const temporary = () => mkdtemp(join(tmpdir(), "raphie-self-"));

test("the default bot may update the owner's profile, new bots only their personality", async () => {
  const directory = await temporary();
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    const first = store.read("default");
    expect(first.selfUpdates).toEqual({
      personality: true,
      owner: true,
      skills: true,
    });
    expect(first.preset).toBe("candid");
    const other = store.insert(
      store.draft({
        name: "Research",
        description: "",
        personality: PERSONALITY_PRESETS[4]!.personality,
      }),
    );
    expect(other.selfUpdates).toEqual({
      personality: true,
      owner: false,
      skills: true,
    });
    expect(other.preset).toBe("analyst");
    expect(other.changedBy).toBe("owner");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a bot's own edit is a revision marked as its own, and repeating it adds none", async () => {
  const directory = await temporary();
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    const edited = store.updatePersonality("default", "Be blunt.");
    expect(edited).toMatchObject({
      revision: 2,
      changedBy: "bot",
      personality: "Be blunt.",
    });
    expect(edited.preset).toBeUndefined();
    expect(store.updatePersonality("default", "Be blunt.").revision).toBe(2);
    // The owner's restore is theirs again, and the preset is recognised.
    const restored = store.update("default", {
      name: edited.name,
      description: edited.description,
      personality: PERSONALITY_PRESETS[0]!.personality,
      revision: 2,
    });
    expect(restored).toMatchObject({
      revision: 3,
      changedBy: "owner",
      preset: "candid",
    });
    expect(restored.selfUpdates).toEqual(edited.selfUpdates);
    expect(store.history("default").map((r) => r.changedBy)).toEqual([
      "owner",
      "bot",
      "owner",
    ]);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function selfTools(allowed: { personality: boolean; owner: boolean }) {
  let personality = "Be kind.";
  let owner: OwnerProfile = { ...EMPTY_OWNER, name: "Hana Girma" };
  let rules: string[] = [];
  let instructions = "";
  const extension = createSelfTools({
    profile: () => ({
      id: "default",
      name: "Raphie",
      description: "",
      personality,
      replyStyle: {
        length: "short",
        warmth: "default",
        formatting: "default",
        emoji: false,
      },
      selfUpdates: { ...allowed, skills: false },
      rules,
      instructions,
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    }),
    updatePersonality: (text) => {
      personality = text;
      return { revision: 2 } as never;
    },
    updateRules: (next) => {
      rules = next;
      return { revision: 2 } as never;
    },
    updateInstructions: (next) => {
      instructions = next;
      return { revision: 2 } as never;
    },
    owner: () => owner,
    saveOwner: (input) =>
      (owner = {
        ...input,
        rules: input.rules ?? owner.rules,
        instructions: input.instructions ?? owner.instructions,
        instructionsDefault: false,
        updatedAt: 1,
      }),
  });
  const run = async (name: string, args: Record<string, unknown>) => {
    const tool = extension.tools!.find((t) => t.name === name)!;
    const result = (await tool.execute(
      args as never,
      {} as never,
      {} as never,
    )) as {
      isError: boolean;
      output: { text: string }[];
    };
    return { error: result.isError, text: result.output[0]!.text };
  };
  return {
    run,
    personality: () => personality,
    owner: () => owner,
    rules: () => rules,
    instructions: () => instructions,
  };
}

test("the tools change only what the owner allows, and keep what they are not sent", async () => {
  const off = selfTools({ personality: false, owner: false });
  expect(
    (await off.run("update_personality", { personality: "Be curt." })).error,
  ).toBe(true);
  expect(off.personality()).toBe("Be kind.");
  expect((await off.run("update_owner_profile", { callMe: "H" })).error).toBe(
    true,
  );

  const on = selfTools({ personality: true, owner: true });
  expect(
    (await on.run("update_personality", { personality: " Be curt. " })).error,
  ).toBe(false);
  expect(on.personality()).toBe("Be curt.");
  expect(
    (await on.run("update_owner_profile", { timeZone: "Mars/Olympus" })).error,
  ).toBe(true);
  expect(
    (
      await on.run("update_owner_profile", {
        timeZone: "Africa/Addis_Ababa",
        callMe: "Hana",
      })
    ).error,
  ).toBe(false);
  expect(on.owner()).toMatchObject({
    name: "Hana Girma",
    callMe: "Hana",
    timeZone: "Africa/Addis_Ababa",
    about: "",
  });
});

test("a bot is told what it may change, and asks lightly for what it does not know", () => {
  expect(
    selfUpdateInstructions(
      { personality: false, owner: false, skills: false },
      EMPTY_OWNER,
    ),
  ).toBe("");
  const lacking = selfUpdateInstructions(
    { personality: true, owner: true, skills: true },
    { ...EMPTY_OWNER, name: "Hana Girma" },
  );
  expect(lacking).toContain("update_personality");
  expect(lacking).toContain(
    "You do not know their time zone, a little about them and what they do yet.",
  );
  expect(lacking).not.toContain("what to call them");
  const known = selfUpdateInstructions(
    { personality: false, owner: true, skills: true },
    {
      name: "Hana Girma",
      callMe: "",
      timeZone: "Africa/Addis_Ababa",
      about: "Runs a studio.",
      rules: [],
      instructions: "",
      instructionsDefault: false,
      updatedAt: 1,
    },
  );
  expect(known).not.toContain("update_personality");
  expect(known).not.toContain("You do not know");
});

test("a bot saves, changes and removes standing rules, for itself or for every bot", async () => {
  const bot = selfTools({ personality: true, owner: true });
  const calendar = "Use Executor for calendar, mail and tickets.";
  expect((await bot.run("save_rule", { rule: `- ${calendar}` })).error).toBe(
    false,
  );
  // The same rule again saves nothing new.
  expect((await bot.run("save_rule", { rule: calendar })).text).toBe(
    "That rule is already saved.",
  );
  expect(bot.rules()).toEqual([calendar]);
  expect(bot.owner().rules).toEqual([]);
  const clock = "Give times on a 12-hour clock.";
  expect(
    (await bot.run("save_rule", { rule: clock, everyBot: true })).text,
  ).toContain("Every bot reads it");
  expect(bot.owner().rules).toEqual([clock]);
  // Saving a rule keeps the rest of the owner's profile.
  expect(bot.owner().name).toBe("Hana Girma");

  const cards = "Use Executor for calendar and mail, and answer with a card.";
  await bot.run("save_rule", { rule: cards, replaces: calendar });
  expect(bot.rules()).toEqual([cards]);
  const unknown = await bot.run("save_rule", {
    rule: "",
    replaces: "Never use cards.",
  });
  expect(unknown.error).toBe(true);
  expect(unknown.text).toContain(cards);
  expect((await bot.run("save_rule", { rule: "", replaces: cards })).text).toBe(
    "Removed. You read the rules without it from the next message.",
  );
  expect(bot.rules()).toEqual([]);
  expect((await bot.run("save_rule", { rule: " " })).error).toBe(true);

  for (let index = 0; index < MAX_RULES; index++)
    await bot.run("save_rule", { rule: `Rule ${index}.` });
  expect((await bot.run("save_rule", { rule: "One more." })).error).toBe(true);
  expect(bot.rules()).toHaveLength(MAX_RULES);

  // A bot that may not change the owner's profile keeps a rule to itself.
  const own = selfTools({ personality: true, owner: false });
  const refused = await own.run("save_rule", { rule: clock, everyBot: true });
  expect(refused.error).toBe(true);
  expect(refused.text).toContain("without everyBot");
  expect(own.owner().rules).toEqual([]);
  const none = selfTools({ personality: false, owner: false });
  expect((await none.run("save_rule", { rule: clock })).error).toBe(true);
  expect(none.rules()).toEqual([]);
});

test("standing rules are read in every conversation, the owner's first", () => {
  expect(rulesInstructions([], [])).toBe("");
  const text = rulesInstructions(
    ["Give times on a 12-hour clock."],
    ["* Use Executor  for calendar.", "Give times on a 12-hour clock.", " "],
  );
  expect(text).toContain("Follow each one in every conversation");
  expect(text).toEndWith(
    "- Give times on a 12-hour clock.\n- Use Executor for calendar.\n",
  );
  const told = selfUpdateInstructions(
    { personality: true, owner: false, skills: false },
    EMPTY_OWNER,
  );
  expect(told).toContain("save_rule");
  expect(told).not.toContain("everyBot");
  expect(
    selfUpdateInstructions(
      { personality: false, owner: false, skills: false },
      EMPTY_OWNER,
    ),
  ).toBe("");
});

test("presets are served, and a bot's self-updates are saved with its profile", async () => {
  const directory = await temporary();
  const open = async (botId: string, path: string) => {
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel(),
    });
    return { gateway, close: () => gateway.close() };
  };
  const original = await open("default", directory);
  const host = await BotHost.open(directory, original, open);
  const server = await startServer(original.gateway, { port: 0, bots: host });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${server.url}/api/bots${path}`, {
      method,
      headers: {
        "x-raphie-client": "web",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const presets = (await (await call("GET", "/personalities")).json()) as {
      items: PersonalityPreset[];
    };
    expect(presets.items.map((p) => p.id)).toEqual([
      "candid",
      "chief-of-staff",
      "companion",
      "coach",
      "analyst",
      "creative",
    ]);
    const saved = await call("POST", "/default/profile", {
      name: "Raphie",
      description: "",
      personality: "Be kind.",
      selfUpdates: { personality: false, owner: true },
      revision: 1,
    });
    expect(saved.status).toBe(200);
    // A client that does not send `skills` keeps it as it was.
    expect(host.read("default").selfUpdates).toEqual({
      personality: false,
      owner: true,
      skills: true,
    });
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
