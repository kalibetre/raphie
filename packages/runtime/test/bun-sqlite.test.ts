import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BunSqliteDatabase } from "../src/infrastructure/storage/bun-sqlite.ts";
import { chatModel } from "./chat-model.ts";

test("Bun driver isolates awaited transactions, rolls back, expires handles and drains before close", async () => {
  const db = new BunSqliteDatabase(":memory:");
  await db.exec("CREATE TABLE values_test (value INTEGER, bytes BLOB)");
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  let handle: SqliteExecutor | undefined;
  const failure = new Error("Rollback this transaction");
  const transaction = db.transaction(async (tx) => {
    handle = tx;
    await tx.run(
      "INSERT INTO values_test VALUES (?, ?)",
      1,
      new Uint8Array([0, 255]),
    );
    started();
    await pause;
    throw failure;
  });
  await ready;
  const read = db.all<{ value: number }>("SELECT value FROM values_test");
  release();
  await assert.rejects(transaction, (error) => error === failure);
  assert.deepEqual(await read, []);
  await assert.rejects(handle!.exec("SELECT 1"), /no longer active/);
  await db.transaction(async (tx) => {
    await tx.run(
      "INSERT INTO values_test VALUES (?, ?)",
      2,
      new Uint8Array([0, 255]),
    );
  });
  const pending = db.get<{ bytes: Uint8Array }>(
    "SELECT bytes FROM values_test",
  );
  await db.close();
  assert.deepEqual((await pending)!.bytes, new Uint8Array([0, 255]));
  await db.close();
  await assert.rejects(db.exec("SELECT 1"), /closed/);
});

test("Pi storage opens the same schema with official Node and native Bun drivers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bun-sqlite-"));
  try {
    let app = await Gateway.open({ directory, ...chatModel() });
    const sent = await app.sessions.submit(app.actors.establish("web"), {
      eventId: "native",
      text: "Keep this history",
    });
    await app.close();
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(directory, "gateway.sqlite")),
      { registry: createRegistry(), models: chatModel().models },
      context,
    );
    const root = await harness.root(context);
    assert.ok(root.id);
    await harness.close(context);
    app = await Gateway.open({ directory, ...chatModel() });
    assert.equal(
      (await app.chats.state()).conversations[0].sessionId,
      sent.sessionId,
    );
    assert.equal((await app.chats.state()).turns[0].id, sent.id);
    await app.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a rollback failure is distinguishable from a guaranteed rollback", async () => {
  const db = new BunSqliteDatabase(":memory:");
  const failure = new Error("Original operation failed");
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("ROLLBACK");
        throw failure;
      }),
      (error) => error instanceof AggregateError && error.errors[0] === failure,
    );
    assert.deepEqual(await db.get("SELECT 1 AS value"), { value: 1 });
  } finally {
    await db.close();
  }
});
