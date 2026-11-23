import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMcpTools } from "../src/domains/approvals/infrastructure/mcp-approval-gate.ts";
import {
  appsFromSkills,
  appsLine,
  connectedServicesInstructions,
} from "../src/domains/settings/domain/connected-services.ts";
import { BotMcp } from "../src/domains/settings/infrastructure/bot-mcp.ts";
import { gatewayApps } from "../src/domains/settings/infrastructure/gateway-apps.ts";
import type { McpClient } from "../src/infrastructure/mcp/client.ts";
import { ModelConnectionGate } from "../src/shared/infrastructure/model-connection-gate.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

const skill = (name: string, slug: string, skillName = "tools") => ({
  name: skillName,
  description: `${name} tools.`,
  app: { id: `app_${slug}`, name, slug },
});

const LISTING = {
  skills: [
    skill("Jira", "jira"),
    skill("GitHub", "github"),
    skill("GitHub", "github", "tools-mcp"),
    skill("Google Calendar", "google-calendar"),
    skill("Executor", "executor", "code-mode"),
    { name: "broken" },
  ],
  unavailableApps: [],
};

/** A server that answers `skills` with `listing`, and counts the calls. */
function executor(listing: () => unknown, name = "executor") {
  const calls: unknown[] = [];
  const client: McpClient = {
    server: { name, version: "1" },
    tools: [
      { name: "search", inputSchema: { type: "object" } },
      { name: "skills", inputSchema: { type: "object" } },
    ],
    call: async (tool, args) => {
      calls.push([tool, args]);
      return { content: [{ type: "text", text: JSON.stringify(listing()) }] };
    },
    close: async () => {},
  };
  return { client, calls };
}

test("a gateway's apps are read from its skills, each once, without the gateway itself", () => {
  expect(appsFromSkills(LISTING, "executor")).toEqual([
    "Jira (jira)",
    "GitHub (github)",
    "Google Calendar (google-calendar)",
  ]);
  for (const other of [null, "text", {}, { skills: "none" }, { skills: [1] }])
    expect(appsFromSkills(other, "executor")).toEqual([]);
  const many = Array.from({ length: 45 }, (_, n) => `App ${n} (app-${n})`);
  expect(appsLine(many)).toEndWith("App 39 (app-39) and 5 more");
});

test("only Executor is asked, with nothing, and a silent one is left unlisted", async () => {
  const asked = executor(() => LISTING);
  expect(await gatewayApps(asked.client)).toEqual([
    "Jira (jira)",
    "GitHub (github)",
    "Google Calendar (google-calendar)",
  ]);
  // The listing call takes no arguments, so it acts on nothing.
  expect(asked.calls).toEqual([["skills", {}]]);

  const other = executor(() => LISTING, "fizzy");
  expect(await gatewayApps(other.client)).toBeUndefined();
  expect(other.calls).toEqual([]);

  const failing = executor(() => LISTING);
  failing.client.call = async () => {
    throw new Error("timed out");
  };
  expect(await gatewayApps(failing.client)).toBeUndefined();
  const garbled = executor(() => "not a listing");
  expect(await gatewayApps(garbled.client)).toBeUndefined();
});

test("the bot is told a gateway's apps, and a search for one finds its tools", () => {
  const apps = ["Gmail (gmail)", "Google Calendar (google-calendar)"];
  const text = connectedServicesInstructions([{ name: "Executor", apps }]);
  expect(text).toContain(
    "- Executor\n  Apps in it, each found by searching it for the slug in brackets: Gmail (gmail), Google Calendar (google-calendar)\n",
  );
  const { client } = executor(() => LISTING);
  client.apps = apps;
  const [search] = createMcpTools({} as never, {
    client,
    identity: "account",
    namespace: "c_1",
    name: "Executor",
  }).tools!;
  expect(search!.description).toContain(
    "Apps in Executor: Gmail (gmail), Google Calendar (google-calendar)",
  );
});

test("a connection shows its apps, and a new app reaches the bot on the next refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-gateway-apps-"));
  let listing: unknown = LISTING;
  let busy = false;
  const published: (string[] | undefined)[] = [];
  const { client } = executor(() => listing);
  const mcp = await BotMcp.open(join(directory, "mcp.sqlite"), {
    keyStore: memoryCredentialKeyStore(),
    gate: new ModelConnectionGate(),
    busy: async () => busy,
    publish: (tools) => published.push(tools[0]?.client.apps),
    connect: async () => ({ ...client }),
  });
  try {
    const [added] = await mcp.add({
      name: "Executor",
      transport: "http",
      url: "http://localhost/mcp",
    });
    // Shown in Settings by name, where a purpose would be typed.
    expect(added!.summary).toBe("Apps: Jira, GitHub, Google Calendar");
    expect(published.at(-1)).toHaveLength(3);
    const before = published.length;

    // Nothing changed: nothing is published again.
    await mcp.refreshApps();
    expect(published).toHaveLength(before);

    listing = { skills: [...LISTING.skills, skill("Gmail", "gmail")] };
    // A working bot is left alone; the next round picks the change up.
    busy = true;
    await mcp.refreshApps();
    expect(published).toHaveLength(before);
    busy = false;
    await mcp.refreshApps();
    expect(published.at(-1)).toContain("Gmail (gmail)");
    expect(mcp.read()[0]!.summary).toBe(
      "Apps: Jira, GitHub, Google Calendar, Gmail",
    );

    // A gateway that stops answering keeps the list it gave.
    listing = "down";
    await mcp.refreshApps();
    expect(mcp.read()[0]!.summary).toContain("Gmail");
  } finally {
    await mcp.close();
    await rm(directory, { recursive: true, force: true });
  }
});
