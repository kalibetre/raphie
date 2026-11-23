import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import {
  localTime,
  ownerInstructions,
} from "../src/domains/bots/domain/owner.ts";
import { chatModel } from "./chat-model.ts";

test("the owner's profile is shared by every bot, survives a restart and reaches each turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-owner-"));
  const prompts: string[] = [];
  const messages: string[] = [];
  const open = async (botId: string, path: string) => {
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel({
        systemPrompt: (text) => prompts.push(text),
        userMessages: (sent) => messages.push(JSON.stringify(sent.at(-1))),
      }),
    });
    return { gateway, close: () => gateway.close() };
  };
  let original = await open("default", directory);
  let host = await BotHost.open(directory, original, open);
  let server = await startServer(original.gateway, { port: 0, bots: host });
  const call = (method: string, body?: unknown) =>
    fetch(`${server.url}/api/owner`, {
      method,
      headers: {
        "x-raphie-client": "web",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    expect(await (await call("GET")).json()).toEqual({
      name: "",
      callMe: "",
      timeZone: "",
      about: "",
      rules: [],
      updatedAt: null,
    });
    const owner = {
      name: "Hana Girma",
      callMe: "Hana",
      timeZone: "Africa/Addis_Ababa",
      about: "I run a small studio. Mornings are for deep work.",
    };
    expect(
      (await call("PUT", { ...owner, timeZone: "Mars/Olympus" })).status,
    ).toBe(400);
    expect(
      (await call("PUT", { ...owner, about: "x".repeat(2001) })).status,
    ).toBe(400);
    const clock = "Give times on a 12-hour clock.";
    expect(
      (await call("PUT", { ...owner, rules: [` ${clock}`, clock] })).status,
    ).toBe(200);
    expect(
      (await call("PUT", { ...owner, rules: ["x".repeat(301)] })).status,
    ).toBe(400);
    // A client older than rules saves the profile without them, and they stay.
    expect((await call("PUT", owner)).status).toBe(200);
    expect(await (await call("GET")).json()).toMatchObject({ rules: [clock] });

    await server.close();
    await host.close();
    await original.close();
    original = await open("default", directory);
    host = await BotHost.open(directory, original, open);
    server = await startServer(original.gateway, { port: 0, bots: host });
    expect(await (await call("GET")).json()).toMatchObject(owner);

    // A second bot reads the same owner.
    const second = await host.create({
      name: "Research",
      description: "",
      personality: "Cite sources.",
      rules: ["Link every source."],
    });
    for (const id of ["default", second.id]) {
      const { gateway } = host.runtime(id);
      const turn = await gateway.chats.send({
        source: "web",
        actor: "owner",
        eventId: `hello-${id}`,
        text: "What should I do this morning?",
      });
      for (
        let n = 0;
        n < 300 &&
        (await gateway.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "pending";
        n++
      )
        await delay(10);
    }
    const told = prompts.filter((p) => p.includes("Call them Hana."));
    expect(told.some((p) => p.includes("Cite sources."))).toBe(true);
    expect(told.some((p) => p.includes("Use a warm, natural voice."))).toBe(
      true,
    );
    expect(told[0]).toContain("Mornings are for deep work.");
    // Every bot reads the owner's rules; a bot's own rules stay with it.
    expect(told.every((p) => p.includes(`- ${clock}`))).toBe(true);
    expect(told.filter((p) => p.includes("- Link every source."))).toHaveLength(
      1,
    );
    expect(told.find((p) => p.includes("- Link every source."))).toContain(
      "Cite sources.",
    );
    // Each message says when it was sent on the owner's clock too.
    expect(messages.at(-1)).toMatch(/in Africa\/Addis_Ababa\]/);
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("an owner who says nothing is not described, and times read like a clock", () => {
  expect(
    ownerInstructions({
      name: "",
      callMe: "",
      timeZone: "",
      about: "",
      rules: [],
      updatedAt: null,
    }),
  ).toBe("");
  expect(localTime(Date.UTC(2026, 10, 21, 9, 40), "Africa/Addis_Ababa")).toBe(
    "Saturday 21 November 2026, 12:40",
  );
});
