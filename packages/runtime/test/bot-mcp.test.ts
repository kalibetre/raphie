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
