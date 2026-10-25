import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";

test("SIGKILL during compute preserves the committed checkpoint and retry receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-crash-"));
  const path = join(directory, "checkpoint.sqlite");
  const child = spawn(
    process.execPath,
    [new URL("./workspace-crash-worker.ts", import.meta.url).pathname, path],
    { stdio: ["ignore", "pipe", "pipe"], env: {} },
  );
  let workspace: BotWorkspace | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Crash fixture did not start")),
        5000,
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("compute-started")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Crash fixture exited early"));
      });
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    workspace = await BotWorkspace.open(path);
    expect(
      (await workspace.execute("session", "read", "cat note")).stdout,
    ).toBe("exactly-once\n");
    await workspace.execute(
      "session",
      "committed",
      "echo exactly-once >> note",
    );
    expect(
      (await workspace.execute("session", "read-retry", "cat note")).stdout,
    ).toBe("exactly-once\n");
    await workspace.execute("session", "interrupted", "echo recovered >> note");
    expect(
      (await workspace.execute("session", "read-recovered", "cat note")).stdout,
    ).toBe("exactly-once\nrecovered\n");
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await workspace?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

test("Pi recovery after a committed checkpoint reuses the tool receipt instead of appending twice", async () => {
  const { Gateway } = await import("../src/bootstrap/agent-runtime.ts");
  const { chatModel } = await import("./chat-model.ts");
  const directory = await mkdtemp(
    join(tmpdir(), "raphie-workspace-tool-crash-"),
  );
  const child = spawn(
    process.execPath,
    [
      new URL("./workspace-tool-crash-worker.ts", import.meta.url).pathname,
      directory,
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: {} },
  );
  let gateway: Awaited<ReturnType<typeof Gateway.open>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Tool crash fixture did not commit")),
        5000,
      );
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("checkpoint-committed")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Tool crash fixture exited early"));
      });
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const model = chatModel({
      tool: { name: "workspace_exec", args: { command: "echo once >> note" } },
    });
    gateway = await Gateway.open({
      directory,
      models: model.models,
      model: { provider: "fixture", modelId: "history" },
    });
    let completed = false;
    for (let i = 0; i < 200; i++) {
      const turns = (await gateway.chats.state()).turns;
      if (turns.length && turns.every((t) => t.status !== "pending")) {
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(completed).toBe(true);
    expect(JSON.stringify((await gateway.chats.state()).turns)).toContain(
      "committed",
    );
    expect(
      (await gateway.workspace.execute("owner-check", "verify", "cat note"))
        .stdout,
    ).toBe("once\n");
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await gateway?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
