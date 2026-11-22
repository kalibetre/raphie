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
import { BotProfileStore } from "../src/domains/bots/infrastructure/bot-profiles.ts";
import { createSelfTools } from "../src/domains/bots/infrastructure/self-tools.ts";
import { chatModel } from "./chat-model.ts";

const temporary = () => mkdtemp(join(tmpdir(), "raphie-self-"));

test("the default bot may update the owner's profile, new bots only their personality", async () => {
  const directory = await temporary();
  const store = new BotProfileStore(join(directory, "bots.sqlite"));
  try {
    const first = store.read("default");
    expect(first.selfUpdates).toEqual({ personality: true, owner: true });
    expect(first.preset).toBe("candid");
    const other = store.insert(
      store.draft({
        name: "Research",
        description: "",
        personality: PERSONALITY_PRESETS[4]!.personality,
      }),
    );
    expect(other.selfUpdates).toEqual({ personality: true, owner: false });
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
      selfUpdates: allowed,
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    }),
    updatePersonality: (text) => {
      personality = text;
      return { revision: 2 } as never;
    },
    owner: () => owner,
    saveOwner: (input) => (owner = { ...input, updatedAt: 1 }),
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
  return { run, personality: () => personality, owner: () => owner };
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
    selfUpdateInstructions({ personality: false, owner: false }, EMPTY_OWNER),
  ).toBe("");
  const lacking = selfUpdateInstructions(
    { personality: true, owner: true },
    { ...EMPTY_OWNER, name: "Hana Girma" },
  );
  expect(lacking).toContain("update_personality");
  expect(lacking).toContain(
    "You do not know their time zone, a little about them and what they do yet.",
  );
  expect(lacking).not.toContain("what to call them");
  const known = selfUpdateInstructions(
    { personality: false, owner: true },
    {
      name: "Hana Girma",
      callMe: "",
      timeZone: "Africa/Addis_Ababa",
      about: "Runs a studio.",
      updatedAt: 1,
    },
  );
  expect(known).not.toContain("update_personality");
  expect(known).not.toContain("You do not know");
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
    expect(host.read("default").selfUpdates).toEqual({
      personality: false,
      owner: true,
    });
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
