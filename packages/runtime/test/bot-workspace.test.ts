import { expect, test } from "bun:test";
import assert from "node:assert/strict";
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

test("workspace rolls back time, output, storage and entry overages, then remains usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-bounds-"));
  const workspace = await BotWorkspace.open(
    join(directory, "checkpoint.sqlite"),
  );
  try {
    await workspace.execute("one", "seed", "echo safe > marker");
    const output = await workspace.execute(
      "one",
      "output",
      "echo unsafe > marker; printf '%040000d' 0",
    );
    expect(output.committed).toBe(false);
    expect(
      Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr),
    ).toBeLessThanOrEqual(32768);
    const storage = await workspace.execute(
      "one",
      "storage",
      'set -e; mkdir tree; printf "%032000d" 0 > tree/file; for i in $(seq 1 9); do cp -r tree copy; mv copy tree/copy$i; done',
    );
    expect(storage.committed).toBe(false);
    const entries = await workspace.execute(
      "one",
      "entries",
      "mkdir $(seq 1 1100)",
    );
    expect(entries.committed).toBe(false);
    const started = Date.now();
    const timed = await workspace.execute(
      "one",
      "timeout",
      "echo unsafe > marker; sleep 60",
    );
    expect(timed.committed).toBe(false);
    expect(Date.now() - started).toBeLessThan(6500);
    expect(
      (await workspace.execute("two", "read", "cat marker; test ! -e 1"))
        .stdout,
    ).toBe("safe\n");
  } finally {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 12_000);

test("queue and runtime compute capacity are independently bounded across bot stores", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-capacity-"));
  const stores = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      BotWorkspace.open(join(directory, `${i}.sqlite`)),
    ),
  );
  try {
    const runs = stores.map((store) =>
      store.execute("session", "slow", "sleep 0.3"),
    );
    const results = await Promise.allSettled(runs);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const queued = Array.from({ length: 16 }, (_, i) =>
      stores[0].execute("session", `queued-${i}`, "sleep 0.1"),
    );
    expect(() => stores[0].execute("session", "over-capacity", "true")).toThrow(
      "queue is full",
    );
    const settled = Promise.allSettled(queued);
    await stores[0].close();
    expect((await settled).every((r) => r.status === "rejected")).toBe(true);
  } finally {
    await Promise.all(stores.map((s) => s.close()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint and receipt roll back together on a storage failure; full receipts stop new work", async () => {
  const { Database } = await import("bun:sqlite");
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-atomic-"));
  const path = join(directory, "checkpoint.sqlite");
  const workspace = await BotWorkspace.open(path);
  const db = new Database(path);
  try {
    await workspace.execute("session", "seed", "echo safe > note");
    db.exec(
      "CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF checkpoint ON workspace BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END",
    );
    await assert.rejects(
      workspace.execute("session", "append", "echo once >> note"),
      /synthetic disk failure/,
    );
    expect(
      db.query("SELECT id FROM executions WHERE id='append'").get(),
    ).toBeNull();
    db.exec("DROP TRIGGER fail_checkpoint");
    expect(
      (await workspace.execute("session", "read", "cat note")).stdout,
    ).toBe("safe\n");
    await workspace.execute("session", "append", "echo once >> note");
    expect(
      (await workspace.execute("session", "read-after", "cat note")).stdout,
    ).toBe("safe\nonce\n");
    db.exec("UPDATE workspace SET receipt_bytes=16777216");
    await assert.rejects(
      workspace.execute("session", "new", "echo lost > note"),
      /history is full/,
    );
    // Old calls still resolve at capacity, so recovery never repeats a write.
    expect(
      (await workspace.execute("session", "append", "echo once >> note"))
        .committed,
    ).toBe(true);
    expect(
      db.query("SELECT id FROM executions WHERE id='new'").get(),
    ).toBeNull();
  } finally {
    db.close();
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});
