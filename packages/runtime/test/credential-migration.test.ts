import { Database } from "bun:sqlite";
import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { redact } from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

function options() {
  const models = createModels();
  models.setProvider(openrouterProvider());
  return {
    models,
    defaultModel: models.getModels("openrouter")[0]!.id,
    credentialKeyStore: memoryCredentialKeyStore(),
    verifyKey: async () => {},
  };
}

function saved(path: string) {
  const db = new Database(path);
  try {
    return db.query<{ value: string }, []>("SELECT value FROM settings").get()!
      .value;
  } finally {
    db.close();
  }
}

const credentials = ["SYNTHETIC_PERSONAL_KEY", "SYNTHETIC_WORK_KEY"];

function legacy(path: string, modelId: string) {
  const db = new Database(path);
  // Leave historical plaintext in freelist pages and WAL to exercise cleanup.
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA secure_delete=OFF; CREATE TABLE settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
  );
  const state = {
    version: 3,
    telemetryEnabled: false,
    modelId,
    connectionId: "stable_work",
    connections: credentials
      .map((apiKey, index) => ({
        id: index ? "stable_work" : "stable_personal",
        name: index ? "Work" : "Personal",
        provider: "openrouter",
        enabled: true,
        apiKey: apiKey as string | null,
      }))
      .concat([
        {
          id: "stable_empty",
          name: "Empty",
          provider: "openrouter",
          enabled: false,
          apiKey: null,
        },
      ]),
  };
  db.query("INSERT INTO settings VALUES(1, ?)").run(JSON.stringify(state));
  db.exec("CREATE TABLE discarded(value TEXT)");
  db.query("INSERT INTO discarded VALUES (?)").run(
    credentials[0]!.repeat(1000),
  );
  db.exec("DROP TABLE discarded");
  return db;
}

test("v3 migration preserves IDs, disabled/empty entries and per-connection auth while scrubbing DB and WAL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cipher-migration-"));
  const path = join(directory, "settings.sqlite");
  const config = options();
  const source = join(directory, "source.sqlite");
  const old = legacy(source, config.defaultModel);
  // Copy a synthetic live snapshot with its WAL, then remove the source fixture.
  await copyFile(source, path);
  await copyFile(`${source}-wal`, `${path}-wal`);
  old.close();
  await rm(source);
  let settings = await BackendSettings.open(path, config);
  try {
    assert.equal(settings.model!.provider, "stable_work");
    assert.equal(settings.key, credentials[1]);
    assert.equal(settings.telemetryEnabled, false);
    for (const [index, id] of ["stable_personal", "stable_work"].entries()) {
      const auth = await config.models.getAuth(id);
      assert.equal(auth?.auth.apiKey, credentials[index]);
    }
    const disk = JSON.parse(saved(path));
    assert.equal(disk.version, 4);
    assert.deepEqual(
      disk.connections.map((c: { id: string }) => c.id),
      ["stable_personal", "stable_work", "stable_empty"],
    );
    assert.equal(disk.connections[2].credential, null);
    assert.equal("apiKey" in disk.connections[0], false);
    const master = await config.credentialKeyStore.get(disk.keyId);
    assert.ok(master);
    for (const file of await readdir(directory)) {
      const bytes = await readFile(join(directory, file));
      assert.equal(bytes.includes(Buffer.from(master)), false);
      for (const value of credentials)
        assert.equal(bytes.includes(Buffer.from(value)), false);
    }
    assert.equal(
      redact({ message: credentials.join(" ") }).includes("SYNTHETIC"),
      false,
    );
    await settings.editConnection("stable_work", {
      name: "Renamed",
      apiKey: "SYNTHETIC_REPLACEMENT",
    });
    await settings.removeConnection("stable_personal");
    settings.close();
    settings = await BackendSettings.open(path, config);
    assert.equal(settings.key, "SYNTHETIC_REPLACEMENT");
    assert.equal(settings.model!.provider, "stable_work");
    assert.deepEqual(
      (await settings.read()).connections.map((c) => c.id),
      ["stable_work"],
    );
    assert.equal(saved(path).includes("SYNTHETIC"), false);
    await settings.removeConnection("stable_work");
    settings.close();
    settings = await BackendSettings.open(path, config);
    assert.equal(settings.key, undefined);
    assert.equal(JSON.parse(saved(path)).connections.length, 1); // Preserve unconfigured identity.
  } finally {
    settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("locked store and failed SQLite migration preserve plaintext for explicit recovery without serving it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-migration-retry-"));
  const path = join(directory, "settings.sqlite");
  const config = options();
  legacy(path, config.defaultModel).close();
  const before = saved(path);
  try {
    await assert.rejects(
      BackendSettings.open(path, {
        ...config,
        credentialKeyStore: {
          get: async () => {
            throw new Error("SYNTHETIC_SECRET_ERROR");
          },
          set: async () => {},
        },
      }),
      (error: Error) =>
        !String(error).includes("SYNTHETIC") &&
        String(error).includes("unavailable"),
    );
    assert.equal(saved(path), before);
    const blocker = new Database(path);
    blocker.exec(
      "CREATE TRIGGER fail_write BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SECRET_ERROR'); END",
    );
    await assert.rejects(
      BackendSettings.open(path, config),
      (error: Error) =>
        !String(error).includes("SYNTHETIC") &&
        String(error).includes("migrated safely"),
    );
    assert.equal(saved(path), before);
    blocker.exec("DROP TRIGGER fail_write");
    blocker.close();
    const settings = await BackendSettings.open(path, config);
    assert.equal(settings.key, credentials[1]);
    settings.close();
    const encrypted = saved(path);
    await assert.rejects(
      BackendSettings.open(path, {
        ...config,
        credentialKeyStore: memoryCredentialKeyStore(),
      }),
      /key missing/,
    );
    assert.equal(saved(path), encrypted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("interruption after encrypted commit retries cleanup and retains connections on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cleanup-retry-"));
  const path = join(directory, "settings.sqlite");
  const config = options();
  legacy(path, config.defaultModel).close();
  // Capture the receiver-dependent SQLite method for a fault-injection wrapper.
  // oxlint-disable-next-line typescript/unbound-method
  const exec = Database.prototype.exec;
  const failure = spyOn(Database.prototype, "exec").mockImplementation(
    function (this: Database, sql: string) {
      if (sql === "VACUUM") throw new Error("SYNTHETIC_DISK_FAILURE");
      return exec.call(this, sql);
    },
  );
  try {
    await assert.rejects(BackendSettings.open(path, config), /migrated safely/);
  } finally {
    failure.mockRestore();
  }
  try {
    assert.equal(JSON.parse(saved(path)).version, 4);
    const settings = await BackendSettings.open(path, config);
    assert.equal(settings.key, credentials[1]);
    assert.equal(settings.model!.provider, "stable_work");
    settings.close();
    const db = new Database(path);
    const record = JSON.parse(saved(path));
    record.connections[0].credential = record.connections[1].credential;
    db.query("UPDATE settings SET value=?").run(JSON.stringify(record));
    db.close();
    const corrupted = saved(path);
    await assert.rejects(BackendSettings.open(path, config), /authenticated/);
    assert.equal(saved(path), corrupted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed credential edits/removal leave the previous disk row and auth active", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-edit-rollback-"));
  const path = join(directory, "settings.sqlite");
  const config = options();
  legacy(path, config.defaultModel).close();
  const settings = await BackendSettings.open(path, config);
  const db = new Database(path);
  try {
    const before = saved(path);
    db.exec(
      "CREATE TRIGGER fail_write BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SECRET_ERROR'); END",
    );
    await assert.rejects(
      settings.editConnection("stable_work", {
        name: "Changed",
        apiKey: "SYNTHETIC_REPLACEMENT",
      }),
      (error: Error) =>
        !String(error).includes("SYNTHETIC") &&
        String(error).includes("saved securely"),
    );
    await assert.rejects(
      settings.removeConnection("stable_work"),
      /saved securely/,
    );
    assert.equal(saved(path), before);
    assert.equal(settings.key, credentials[1]);
    assert.equal(
      (await config.models.getAuth("stable_work"))?.auth.apiKey,
      credentials[1],
    );
    db.exec("DROP TRIGGER fail_write");
    await settings.removeConnection("stable_work");
    assert.equal(settings.model!.provider, "stable_personal");
  } finally {
    db.close();
    settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});
