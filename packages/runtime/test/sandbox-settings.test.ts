import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";

const defaults = {
  provider: "just-bash" as const,
  idleMinutes: 10,
  diskQuotaMiB: null,
  hostNetworkAcknowledged: false,
  revision: 1,
};

test("sandbox defaults need no existing-data migration; settings survive reopen without changing checkpoint revisions or limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-sandbox-settings-"));
  const path = join(directory, "checkpoint.sqlite");
  let workspace = await BotWorkspace.open(path);
  try {
    await workspace.execute("session", "seed", "echo kept > note");
    const before = workspace.info();
    await workspace.close();
    // Simulate a checkpoint created before sandbox settings existed.
    const db = new Database(path);
    db.exec("DROP TABLE sandbox_settings");
    db.close();
    workspace = await BotWorkspace.open(path);
    expect(workspace.info().settings).toEqual(defaults);
    const saved = workspace.saveSettings({
      ...defaults,
      idleMinutes: 1440,
      diskQuotaMiB: 2048,
    });
    expect(saved.revision).toBe(2);
    await workspace.close();
    workspace = await BotWorkspace.open(path);
    expect(workspace.info().settings).toEqual(saved);
    expect(workspace.info().revision).toBe(before.revision);
    expect(workspace.info().limits).toEqual(before.limits);
    expect(
      workspace.download("/workspace/note", before.revision).bytes.toString(),
    ).toBe("kept\n");
    expect(
      workspace.saveSettings({
        ...saved,
        idleMinutes: 1,
        diskQuotaMiB: undefined,
      }).diskQuotaMiB,
    ).toBeNull();
  } finally {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("sandbox HTTP validates owner edits, requires container acknowledgement and isolates bots and revisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-sandbox-http-"));
  const gateway = await Gateway.open({ directory, deferResume: true });
  const host = await BotHost.open(
    directory,
    { gateway },
    async (botId, path) => {
      const bot = await Gateway.open({
        directory: path,
        botId,
        deferResume: true,
      });
      return { gateway: bot, close: () => bot.close() };
    },
  );
  const server = await startServer(gateway, { port: 0, bots: host });
  const read = (base = "/api/workspace") =>
    fetch(server.url + base).then((r) => r.json());
  const save = (input: unknown, base = "/api/workspace", headers = {}) =>
    fetch(server.url + base + "/settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-raphie-client": "web",
        ...headers,
      },
      body: JSON.stringify(input),
    });
  try {
    const info = await read();
    expect(info.settings).toEqual(defaults);
    expect(info.providers).toEqual([
      { id: "just-bash", name: "just-bash", available: true, reason: null },
      {
        id: "container",
        name: "Container",
        available: true,
        reason: null,
      },
    ]);
    const unavailable = await save({ ...defaults, provider: "container" });
    expect(unavailable.status).toBe(409);
    expect((await unavailable.json()).error).toBe(
      "Acknowledge host and local network access in this bot's Sandbox settings before enabling Container.",
    );
    for (const patch of [
      { idleMinutes: 0 },
      { idleMinutes: 1441 },
      { idleMinutes: 1.5 },
      { idleMinutes: "10" },
      { hostNetworkAcknowledged: "true" },
      { hostNetworkAcknowledged: null },
      { diskQuotaMiB: 0 },
      { diskQuotaMiB: -1 },
      { diskQuotaMiB: 1.5 },
      { diskQuotaMiB: Number.MAX_SAFE_INTEGER + 1 },
      { provider: "vm" },
      { revision: 0 },
      { botId: "another-bot" },
      { id: "default" },
    ])
      expect((await save({ ...defaults, ...patch })).status).toBe(400);
    expect((await read()).settings).toEqual(defaults);
    expect(
      (
        await save(defaults, "/api/workspace", {
          origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    const other = await host.create({
      name: "Other",
      description: "",
      soul: "",
    });
    const otherBase = `/api/bots/${other.id}/workspace`;
    const [one, two] = await Promise.all([
      save({ ...defaults, idleMinutes: 1, diskQuotaMiB: 1 }),
      save({ ...defaults, idleMinutes: 1440 }),
    ]);
    expect([one.status, two.status].sort((a, b) => a - b)).toEqual([200, 409]);
    expect((await read()).settings.revision).toBe(2);
    expect((await read(otherBase)).settings).toEqual(defaults);
    const consent = await save({
      ...(await read()).settings,
      hostNetworkAcknowledged: true,
    });
    expect(consent.status).toBe(200);
    expect((await read()).settings.hostNetworkAcknowledged).toBe(true);
    expect((await read(otherBase)).settings.hostNetworkAcknowledged).toBe(
      false,
    );
    expect(
      (await save({ ...defaults, idleMinutes: 30 }, otherBase)).status,
    ).toBe(200);
    expect((await read(otherBase)).settings.idleMinutes).toBe(30);
    expect((await read()).settings.idleMinutes).not.toBe(30);
    expect((await save(defaults, "/api/bots/missing/workspace")).status).toBe(
      404,
    );
    expect((await read("/api/bots/default/workspace")).settings).toEqual(
      (await read()).settings,
    );
  } finally {
    await server.close();
    await host.close();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});
