import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";

test("workspace serializes sessions, deduplicates checkpoints and recovers without cross-bot files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-"));
  const path = join(directory, "a.sqlite");
  let a = await BotWorkspace.open(path);
  const b = await BotWorkspace.open(join(directory, "b.sqlite"));
  try {
    const first = a.execute("one", "append-1", "echo one >> shared");
    const second = a.execute(
      "two",
      "append-2",
      "echo two >> shared; cat shared",
    );
    expect((await first).committed).toBe(true);
    expect((await second).stdout).toBe("one\ntwo\n");
    expect(
      (await b.execute("other", "read", "test ! -e shared")).exitCode,
    ).toBe(0);
    await a.close();
    a = await BotWorkspace.open(path);
    expect(
      (await a.execute("one", "append-1", "echo one >> shared")).committed,
    ).toBe(true);
    expect((await a.execute("three", "read", "cat shared")).stdout).toBe(
      "one\ntwo\n",
    );
    expect(
      a.execute("other-session", "append-1", "echo one >> shared"),
    ).rejects.toThrow("Conflicting");
    expect(
      (await a.execute("one", "failed", "echo bad > shared; false")).committed,
    ).toBe(false);
    expect((await a.execute("one", "read-again", "cat shared")).stdout).toBe(
      "one\ntwo\n",
    );
  } finally {
    await a.close();
    await b.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("replacement fences an in-flight worker and its queued sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-fence-"));
  const path = join(directory, "workspace.sqlite");
  const old = await BotWorkspace.open(path);
  const running = old.execute("old", "slow", "sleep 0.5; echo stale > result");
  const queued = old.execute("old", "queued", "echo queued > result");
  // Observe rejection immediately to avoid an unhandled rejected queue.
  const settled = Promise.allSettled([running, queued]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const replacement = await BotWorkspace.open(path);
  try {
    await replacement.execute("new", "write", "echo fresh > result");
    expect((await settled).every((r) => r.status === "rejected")).toBe(true);
    expect(
      (await replacement.execute("new", "read", "cat result")).stdout,
    ).toBe("fresh\n");
  } finally {
    await old.close();
    await replacement.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("model tool executions derive the bot and session from the runtime, with shared files after restart", async () => {
  const { Gateway } = await import("../src/bootstrap/agent-runtime.ts");
  const { chatModel } = await import("./chat-model.ts");
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-tools-"));
  const open = (command: string, botId = "default") => {
    const model = chatModel({
      tool: { name: "workspace_exec", args: { command } },
    });
    return Gateway.open({
      directory: join(directory, botId),
      botId,
      models: model.models,
      model: { provider: "fixture", modelId: "history" },
    });
  };
  const send = async (
    gateway: Awaited<ReturnType<typeof open>>,
    text: string,
  ) => {
    const actor = gateway.actors.establish("web");
    const receipt = await gateway.sessions.submit(actor, {
      eventId: crypto.randomUUID(),
      text,
    });
    for (let i = 0; i < 200; i++) {
      const state = await gateway.chats.state();
      const turn = state.turns.find((t) => t.id === receipt.id);
      if (turn?.status !== "pending") return turn;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Tool turn did not settle");
  };
  let a = await open("echo remembered > note");
  try {
    const first = await send(a, "Write a file");
    expect(JSON.stringify(first)).toContain('committed\\":true');
    await a.close();
    a = await open("cat note");
    const read = await send(a, "Read from a new conversation");
    expect(JSON.stringify(read)).toContain("remembered");
    const b = await open("test ! -e note", "other");
    try {
      expect(JSON.stringify(await send(b, "Check isolation"))).toContain(
        'committed\\":true',
      );
      expect(
        b.sessions.submit(a.actors.establish("web"), {
          eventId: crypto.randomUUID(),
          text: "forged",
        }),
      ).rejects.toThrow();
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
    await rm(directory, { recursive: true, force: true });
  }
});
