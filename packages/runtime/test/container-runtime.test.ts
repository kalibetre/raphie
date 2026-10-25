import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { JsonObject } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { ContainerCli } from "../src/domains/workspaces/infrastructure/container-cli.ts";
import { chatModel } from "./chat-model.ts";

const cli = new ContainerCli();
let available = true;
try {
  cli.run(["version", "--format", "{{.Server.Version}}"]);
  cli.run([
    "image",
    "inspect",
    process.env.RAPHIE_CONTAINER_IMAGE ?? "raphie-workspace:slice2",
  ]);
} catch (error) {
  available = false;
  console.warn(
    `SKIP container runtime integration: runtime or fixture image unavailable. ${String(error)}`,
  );
}
const containerTest = available ? test : test.skip;

containerTest(
  "Pi restart reports an interrupted native tool without replaying its committed effect",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "raphie-test-pi-container-crash-"),
    );
    const child = fork(
      join(import.meta.dir, "container-tool-crash-worker.ts"),
      [directory],
      {
        execPath: process.execPath,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let gateway: Gateway | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Native tool crash fixture did not commit")),
          10_000,
        );
        child.once("message", () => {
          clearTimeout(timer);
          resolve();
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Native tool fixture exited early"));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const model = chatModel({
        tool: { name: "bash", args: { command: "echo once >> native-count" } },
      });
      gateway = await Gateway.open({
        directory,
        containerNamePrefix: "raphie-test",
        models: model.models,
        model: { provider: "fixture", modelId: "history" },
      });
      for (
        let attempts = 0;
        attempts < 300 &&
        (await gateway.chats.state()).turns.some(
          (turn) => turn.status === "pending",
        );
        attempts++
      )
        await Bun.sleep(20);
      const turns = (await gateway.chats.state()).turns;
      expect(turns.every((turn) => turn.status !== "pending")).toBe(true);
      expect(JSON.stringify(turns)).toContain("interrupted");
      expect(
        getOrThrow(
          await gateway.workspace
            .env("inspect")
            .readTextFile("native-count", context),
        ),
      ).toBe("once\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      if (!gateway)
        gateway = await Gateway.open({
          directory,
          containerNamePrefix: "raphie-test",
          deferResume: true,
        });
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

containerTest(
  "owner opt-in wires Pi tools, shared sessions and live file routes; switching preserves both stores",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "raphie-test-native-runtime-"),
    );
    const offered: string[][] = [];
    const tool: { name: string; args: JsonObject } = {
      name: "bash",
      args: {
        command: "echo shared >> note; printf '\\000\\377' > binary; cat note",
      },
    };
    const model = chatModel({
      tool,
      offeredTools: (names) => {
        if (names.length) offered.push(names);
      },
    });
    const options = {
      directory,
      containerNamePrefix: "raphie-test" as const,
      models: model.models,
      model: { provider: "fixture", modelId: "history" },
    };
    let gateway = await Gateway.open(options);
    const server = await startServer(gateway, { port: 0 });
    const get = (path: string) => fetch(server.url + "/api/workspace" + path);
    const save = (input: unknown) =>
      fetch(server.url + "/api/workspace/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-raphie-client": "web",
        },
        body: JSON.stringify(input),
      });
    try {
      await gateway.workspace.execute(
        "s",
        "checkpoint",
        "echo virtual > virtual-file",
      );
      const defaults = (await gateway.workspace.info()).settings;
      expect(
        (await gateway.workspace.info()).providers.find(
          (p) => p.id === "container",
        )?.available,
      ).toBe(true);
      const selected = await save({
        ...defaults,
        provider: "container",
        hostNetworkAcknowledged: true,
        idleMinutes: 1,
      });
      expect(selected.status).toBe(200);
      const nativeSettings = await selected.json();
      expect(nativeSettings.hostNetworkAcknowledged).toBe(true);
      expect(
        (await save({ ...nativeSettings, hostNetworkAcknowledged: false }))
          .status,
      ).toBe(409);
      expect((await gateway.workspace.info()).provider.id).toBe("container");
      for (let i = 0; i < 2; i++) {
        await gateway.sessions.submit(gateway.actors.establish("web"), {
          eventId: `native-${i}`,
          text: "Write in the workspace",
        });
        for (
          let attempts = 0;
          attempts < 300 &&
          (await gateway.chats.state()).turns.some(
            (turn) => turn.status === "pending",
          );
          attempts++
        )
          await Bun.sleep(20);
      }
      expect(
        (await gateway.chats.state()).turns.every(
          (turn) => turn.status === "done",
        ),
      ).toBe(true);
      expect(
        offered.every(
          (names) =>
            names.includes("bash") &&
            names.includes("write") &&
            !names.includes("workspace_exec"),
        ),
      ).toBe(true);
      const listing = await get("/files").then((r) => r.json());
      expect(
        listing.items.map((entry: { name: string }) => entry.name).sort(),
      ).toEqual(["binary", "note"]);
      const download = (path: string, revision = listing.revision) =>
        get(`/download?path=${encodeURIComponent(path)}&revision=${revision}`);
      expect(await download("/workspace/note").then((r) => r.text())).toBe(
        "shared\nshared\n",
      );
      const binary = await download("/workspace/binary");
      expect(binary.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 255]);
      const env = gateway.workspace.env("owner-fixture");
      const failed = getOrThrow(
        await env.exec(
          "echo survives > failed; ln -s /etc/passwd link; ln -s /etc folder-link; false",
          {},
          context,
        ),
      );
      expect(failed.exitCode).toBe(1);
      expect((await download("/workspace/note")).status).toBe(409);
      const changed = await get("/files").then((r) => r.json());
      expect(
        await download("/workspace/failed", changed.revision).then((r) =>
          r.text(),
        ),
      ).toBe("survives\n");
      expect((await download("/workspace/link", changed.revision)).status).toBe(
        400,
      );
      expect((await get("/files?path=/workspace/folder-link")).status).toBe(
        400,
      );
      expect(
        (await get("/files?path=/workspace/../gateway.sqlite")).status,
      ).toBe(400);
      expect((await get("/files?path=/workspace/missing")).status).toBe(404);
      expect(
        (await download("/workspace/virtual-file", changed.revision)).status,
      ).toBe(404);
      const calls: { name: string; args: JsonObject }[] = [
        { name: "write", args: { path: "coded", content: "original" } },
        {
          name: "edit",
          args: {
            path: "coded",
            edits: [{ oldText: "original", newText: "edited" }],
          },
        },
        { name: "read", args: { path: "coded" } },
      ];
      for (const call of calls) {
        tool.name = call.name;
        tool.args = call.args;
        await gateway.sessions.submit(gateway.actors.establish("web"), {
          eventId: `coding-${call.name}`,
          text: `Use ${call.name}`,
        });
        for (
          let attempts = 0;
          attempts < 300 &&
          (await gateway.chats.state()).turns.some(
            (turn) => turn.status === "pending",
          );
          attempts++
        )
          await Bun.sleep(20);
        expect((await gateway.chats.state()).turns.at(-1)?.status).toBe("done");
      }
      expect((await gateway.chats.state()).turns.at(-1)?.answer).toContain(
        "edited",
      );
      const db = new Database(
        join(directory, "workspace", "checkpoint.sqlite"),
      );
      try {
        db.exec(
          "CREATE TRIGGER fail_sandbox_settings BEFORE INSERT ON sandbox_settings BEGIN SELECT RAISE(ABORT,'synthetic settings failure'); END",
        );
        await assert.rejects(
          gateway.saveSandboxSettings({
            ...nativeSettings,
            provider: "just-bash",
          }),
          /synthetic settings failure/,
        );
        expect((await gateway.workspace.info()).provider.id).toBe("container");
        expect(
          getOrThrow(
            await gateway.workspace
              .env("after-storage-failure")
              .readTextFile("coded", context),
          ),
        ).toBe("edited");
      } finally {
        db.exec("DROP TRIGGER fail_sandbox_settings");
        db.close();
      }
      const prior = gateway.workspace.env("old-view");
      const switched = await save({
        ...nativeSettings,
        provider: "just-bash",
        hostNetworkAcknowledged: false,
      });
      expect(switched.status).toBe(200);
      expect((await prior.writeFile("stale", "wrong", context)).ok).toBe(false);
      expect(
        (await gateway.workspace.list()).items.map((entry) => entry.name),
      ).toEqual(["virtual-file"]);
      const back = await save({
        ...(await switched.json()),
        provider: "container",
        hostNetworkAcknowledged: true,
      });
      expect(back.status).toBe(200);
      await server.close();
      await gateway.close();
      gateway = await Gateway.open(options);
      expect(
        getOrThrow(
          await gateway.workspace.env("verify").readTextFile("note", context),
        ),
      ).toBe("shared\nshared\n");
      await gateway.close();
      const legacy = new Database(
        join(directory, "workspace", "checkpoint.sqlite"),
      );
      legacy.exec(
        "UPDATE sandbox_settings SET value=json_remove(value,'$.hostNetworkAcknowledged')",
      );
      legacy.close();
      gateway = await Gateway.open(options);
      const pending = await gateway.workspace.info();
      expect(pending.settings.hostNetworkAcknowledged).toBe(false);
      expect(pending.provider.id).toBe("container");
      expect(pending.usage.fileBytes).toBeNull();
      expect(() => gateway.workspace.env("unacknowledged")).toThrow(
        "Acknowledge",
      );
      await gateway.saveSandboxSettings({
        ...pending.settings,
        hostNetworkAcknowledged: true,
      });
      expect(
        getOrThrow(
          await gateway.workspace
            .env("acknowledged")
            .readTextFile("note", context),
        ),
      ).toBe("shared\nshared\n");
    } finally {
      await server.close();
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
