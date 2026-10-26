import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";
import { ContainerCli } from "../src/domains/workspaces/infrastructure/container-cli.ts";

const missing = new ContainerCli("/nonexistent-raphie-recovery-test-cli");
const missingRun = missing.run.bind(missing);

for (const acknowledged of [true, false]) {
  test(`missing container runtime preserves owner recovery access (acknowledged=${acknowledged})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-recovery-"));
    const checkpoint = await BotWorkspace.open(
      join(directory, "workspace", "checkpoint.sqlite"),
    );
    const settings = checkpoint.saveSettings({
      ...checkpoint.settings(),
      provider: "container",
      hostNetworkAcknowledged: true,
    });
    await checkpoint.close();
    if (!acknowledged) {
      const { Database } = await import("bun:sqlite");
      const db = new Database(
        join(directory, "workspace", "checkpoint.sqlite"),
      );
      db.exec(
        "UPDATE sandbox_settings SET value=json_remove(value,'$.hostNetworkAcknowledged')",
      );
      db.close();
    }
    await mkdir(join(directory, "workspace", "files"), { recursive: true });
    const marker = join(directory, "workspace", "files", "kept");
    await writeFile(marker, "preserved");
    const run = spyOn(ContainerCli.prototype, "run").mockImplementation(
      missingRun,
    );
    let gateway: Gateway | undefined;
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      gateway = await Gateway.open({
        directory,
        containerNamePrefix: "raphie-test",
        deferResume: true,
      });
      server = await startServer(gateway, { port: 0 });
      const response = await fetch(server.url + "/api/workspace");
      expect(response.status).toBe(200);
      const info = await response.json();
      expect(info.settings.provider).toBe("container");
      expect(info.settings.hostNetworkAcknowledged).toBe(acknowledged);
      expect(info.usage.fileBytes).toBeNull();
      expect(
        info.providers.find((entry: { id: string }) => entry.id === "container")
          .reason,
      ).toContain("unavailable");
      expect(() => gateway!.workspace.env("blocked")).toThrow();
      expect((await fetch(server.url + "/api/workspace/files")).status).toBe(
        409,
      );
      // A provider change must still fence possible old writers before committing.
      await assert.rejects(
        gateway.saveSandboxSettings({ ...settings, provider: "just-bash" }),
      );
      expect(gateway.workspace.settings().provider).toBe("container");
      run.mockImplementation((args) => {
        expect(args[0]).toBe("ps");
        return "";
      });
      await gateway.saveSandboxSettings({ ...settings, provider: "just-bash" });
      expect(gateway.workspace.settings().provider).toBe("just-bash");
      expect(await readFile(marker, "utf8")).toBe("preserved");
    } finally {
      await server?.close();
      await gateway?.close();
      run.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("failed usage measurement returns settings and permits switching providers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-usage-recovery-"));
  const run = spyOn(ContainerCli.prototype, "run").mockImplementation((args) =>
    args[0] === "ps" ? "" : missingRun(args),
  );
  let gateway: Gateway | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    gateway = await Gateway.open({
      directory,
      containerNamePrefix: "raphie-test",
      deferResume: true,
    });
    const settings = await gateway.saveSandboxSettings({
      ...gateway.workspace.settings(),
      provider: "container",
      hostNetworkAcknowledged: true,
    });
    server = await startServer(gateway, { port: 0 });
    const response = await fetch(server.url + "/api/workspace");
    expect(response.status).toBe(200);
    const info = await response.json();
    expect(info.settings).toEqual(settings);
    expect(info.usage.fileBytes).toBeNull();
    expect(
      info.providers.find((entry: { id: string }) => entry.id === "container")
        .reason,
    ).toContain("usage");
    const saved = await fetch(server.url + "/api/workspace/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify({ ...settings, provider: "just-bash" }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).provider).toBe("just-bash");
  } finally {
    await server?.close();
    await gateway?.close();
    run.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
