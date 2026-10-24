import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotMcp } from "../src/domains/settings/infrastructure/bot-mcp.ts";
import { ModelConnectionGate } from "../src/shared/infrastructure/model-connection-gate.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

test("MCP settings encrypt credentials, restore connections and keep bot inventories independent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bot-mcp-"));
  const keyStore = memoryCredentialKeyStore();
  let busy = false;
  const published: string[][] = [];
  const options = {
    keyStore,
    gate: new ModelConnectionGate(),
    busy: async () => busy,
    publish: (tools: { namespace?: string }[]) => {
      published.push(tools.map((t) => t.namespace!));
    },
    connect: async () => ({
      server: { name: "fixture", version: "1" },
      tools: [],
      call: async () => ({ content: [] }),
      close: async () => {},
    }),
  };
  let a = await BotMcp.open(join(directory, "a.sqlite"), options);
  const b = await BotMcp.open(join(directory, "b.sqlite"), options);
  try {
    const [entry] = await a.add({
      name: "Private tools",
      transport: "http",
      url: "http://localhost/mcp",
      token: "synthetic-private-mcp-token",
    });
    expect(entry.connected).toBe(true);
    expect(b.read()).toEqual([]);
    expect(JSON.stringify(a.read())).not.toContain(
      "synthetic-private-mcp-token",
    );
    expect(
      (await readFile(join(directory, "a.sqlite"))).includes(
        Buffer.from("synthetic-private-mcp-token"),
      ),
    ).toBe(false);
    busy = true;
    expect(a.change(entry.id, "remove")).rejects.toThrow("active turns");
    busy = false;
    await a.close();
    a = await BotMcp.open(join(directory, "a.sqlite"), options);
    expect(a.read()[0].id).toBe(entry.id);
    expect(a.read()[0].connected).toBe(true);
    await a.change(entry.id, "disable");
    expect(published.at(-1)).toEqual([]);
    expect(a.read()[0].enabled).toBe(false);
    expect(b.change(entry.id, "remove")).rejects.toThrow("not found");
    await a.change(entry.id, "remove");
    expect(a.read()).toEqual([]);
  } finally {
    await a.close();
    await b.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy MCP stays host configured until explicit encrypted import, retaining identity and removal across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-legacy-mcp-"));
  const path = join(directory, "mcp.sqlite");
  const keyStore = memoryCredentialKeyStore();
  const inventories: { namespace?: string; identity: string }[][] = [];
  const options = {
    legacy: {
      transport: "http" as const,
      url: "http://localhost/mcp",
      token: "synthetic-legacy-token",
    },
    keyStore,
    gate: new ModelConnectionGate(),
    busy: async () => false,
    publish: (tools: { namespace?: string; identity: string }[]) =>
      inventories.push(tools),
    connect: async () => ({
      server: { name: "fixture", version: "1" },
      tools: [],
      call: async () => ({ content: [] }),
      close: async () => {},
    }),
  };
  let service = await BotMcp.open(path, options);
  try {
    expect(service.read()[0].source).toBe("environment");
    const identity = inventories.at(-1)![0];
    expect(identity.namespace).toBeUndefined();
    expect(JSON.stringify(service.read())).not.toContain(
      "synthetic-legacy-token",
    );
    await service.add({
      name: "Other",
      transport: "http",
      url: "http://localhost/other",
    });
    await service.close();
    service = await BotMcp.open(path, { ...options, legacy: undefined });
    expect(service.read()).toHaveLength(1); // No automatic copy of environment config.
    await service.close();
    service = await BotMcp.open(path, options);
    await service.change("legacy-environment", "import");
    expect(
      service.read().find((e) => e.id === "legacy-environment")!.source,
    ).toBe("saved");
    expect(
      (await readFile(path)).includes(Buffer.from("synthetic-legacy-token")),
    ).toBe(false);
    await service.close();
    service = await BotMcp.open(path, {
      ...options,
      legacy: { ...options.legacy, token: "changed-host-value" },
    });
    expect(
      inventories.at(-1)!.find((entry) => entry.namespace === undefined)
        ?.identity,
    ).toBe(identity.identity);
    await service.change("legacy-environment", "remove");
    await service.close();
    service = await BotMcp.open(path, options);
    expect(service.read().some((e) => e.id === "legacy-environment")).toBe(
      false,
    );
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy config parsing rejects unsupported transports and never echoes secret arguments", async () => {
  const { legacyMcpConfig } =
    await import("../src/infrastructure/mcp/legacy-config.ts");
  expect(legacyMcpConfig({})).toBeUndefined();
  expect(
    legacyMcpConfig({
      MCP_URL: "http://localhost/mcp",
      MCP_BEARER_TOKEN: "synthetic",
    }),
  ).toEqual({
    transport: "http",
    url: "http://localhost/mcp",
    token: "synthetic",
  });
  expect(() =>
    legacyMcpConfig({ MCP_TRANSPORT: "sse", MCP_URL: "http://localhost/sse" }),
  ).toThrow("unsupported");
  try {
    legacyMcpConfig({
      MCP_TRANSPORT: "stdio",
      MCP_COMMAND: "fixture",
      MCP_ARGS: '["synthetic-private-argument"',
    });
    throw new Error("Expected malformed arguments to fail");
  } catch (error) {
    expect(String(error)).toContain("JSON array");
    expect(String(error)).not.toContain("synthetic-private-argument");
  }
});
