import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SandboxSettings, SaveSandboxSettings } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  sandboxProviders,
  saveSandboxSettingsSchema,
} from "./sandbox-settings.ts";
import { computeWorkspace } from "./workspace-compute.ts";
import {
  checkpointSchema,
  type ExecutionResult,
  executionResultSchema,
  workspaceLimits as limits,
} from "./workspace-protocol.ts";
import {
  downloadWorkspaceFile,
  listWorkspace,
  readCheckpoint,
  sandboxInfo,
} from "./workspace-reader.ts";

type State = {
  epoch: number;
  revision: number;
  checkpoint: string;
  receipt_bytes: number;
  version: number;
};

let activeCompute = 0;

/** Host-owned durable state. Compute receives copies and has no database access. */
export class BotWorkspace {
  private readonly db: Database;
  private readonly epoch: number;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private readonly stop = new AbortController();

  private constructor(db: Database) {
    this.db = db;
    this.epoch = db.transaction(() => {
      const state = this.state();
      if (state.version !== 1)
        throw new Error(
          "Unsupported workspace checkpoint version; preserve the store and upgrade the runtime.",
        );
      checkpointSchema.parse(JSON.parse(state.checkpoint));
      db.query("UPDATE workspace SET epoch=epoch+1 WHERE id=1").run();
      return state.epoch + 1;
    })();
  }

  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    try {
      await chmod(path, 0o600);
      db.exec(`PRAGMA busy_timeout=1000; PRAGMA max_page_count=8192;
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, epoch INTEGER NOT NULL, revision INTEGER NOT NULL, checkpoint TEXT NOT NULL, receipt_bytes INTEGER NOT NULL);
        INSERT OR IGNORE INTO workspace VALUES(1,1,0,0,'[]',0);
        CREATE TABLE IF NOT EXISTS sandbox_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);`);
      return new BotWorkspace(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private state() {
    return this.db
      .query<State, []>("SELECT * FROM workspace WHERE id=1")
      .get()!;
  }

  private current() {
    const state = this.closed ? undefined : this.state();
    if (!state || state.epoch !== this.epoch)
      throw new InputError(
        "Workspace executor was replaced or stopped. Retry on the active runtime.",
        409,
      );
    return state;
  }

  info() {
    const state = this.current();
    return {
      settings: this.settings(),
      providers: sandboxProviders.map((provider) => ({ ...provider })),
      ...sandboxInfo(
        readCheckpoint(state.checkpoint),
        state.revision,
        state.receipt_bytes,
        this.queued,
      ),
    };
  }

  private settings(): SandboxSettings {
    const row = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM sandbox_settings WHERE id=1",
      )
      .get();
    return row
      ? (JSON.parse(row.value) as SandboxSettings)
      : {
          provider: "just-bash",
          idleMinutes: 10,
          diskQuotaMiB: null,
          revision: 1,
        };
  }

  saveSettings(input: SaveSandboxSettings): SandboxSettings {
    const parsed = saveSandboxSettingsSchema.safeParse(input);
    if (!parsed.success)
      throw new InputError(
        "Invalid sandbox settings. Use idle minutes 1–1440 and a positive integer disk quota or no limit.",
      );
    const provider = sandboxProviders.find(
      (entry) => entry.id === parsed.data.provider,
    )!;
    if (!provider.available) throw new InputError(provider.reason!, 409);
    return this.db.transaction(() => {
      this.current();
      const previous = this.settings();
      if (parsed.data.revision !== previous.revision)
        throw new InputError(
          "Sandbox settings changed elsewhere. Reload before saving.",
          409,
        );
      const next = {
        ...parsed.data,
        diskQuotaMiB: parsed.data.diskQuotaMiB ?? null,
        revision: previous.revision + 1,
      };
      this.db
        .query("INSERT OR REPLACE INTO sandbox_settings(id,value) VALUES(1,?)")
        .run(JSON.stringify(next));
      return next;
    })();
  }

  list(path = "/workspace") {
    const state = this.current();
    return listWorkspace(
      readCheckpoint(state.checkpoint),
      state.revision,
      path,
    );
  }

  download(path: string, revision: number) {
    const state = this.current();
    if (state.revision !== revision)
      throw new InputError(
        "Workspace changed since this list was loaded. Refresh before downloading.",
        409,
      );
    return downloadWorkspaceFile(readCheckpoint(state.checkpoint), path);
  }

  /** Caller derives session and operation identities from trusted tool context. */
  execute(
    sessionId: string,
    operationId: string,
    command: string,
    signal?: AbortSignal,
  ): Promise<ExecutionResult> {
    this.current();
    if (!command.trim() || Buffer.byteLength(command) > limits.sourceBytes)
      throw new InputError("Workspace command must contain 1–16384 bytes.");
    if (this.queued >= limits.queued)
      throw new InputError("Workspace queue is full. Retry later.", 409);
    this.queued++;
    const run = this.tail.then(async () => {
      this.current();
      signal?.throwIfAborted();
      const fingerprint = new Bun.CryptoHasher("sha256")
        .update(JSON.stringify([sessionId, command]))
        .digest("hex");
      const receipt = this.db
        .query<{ fingerprint: string; result: string }, [string]>(
          "SELECT fingerprint,result FROM executions WHERE id=?",
        )
        .get(operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new InputError("Conflicting workspace execution retry.", 409);
        return executionResultSchema.parse(JSON.parse(receipt.result));
      }
      const before = this.state();
      // Reserve enough room for a maximum output receipt before doing any work.
      if (
        before.receipt_bytes + limits.outputBytes * 2 + 4096 >
        limits.receiptsBytes
      )
        throw new InputError(
          "Workspace execution history is full. Export and archive it before continuing.",
          409,
        );
      if (activeCompute >= limits.concurrent)
        throw new InputError(
          "Lightweight execution capacity is busy. Retry later.",
          409,
        );
      activeCompute++;
      let response;
      try {
        response = await computeWorkspace(
          {
            checkpoint: checkpointSchema.parse(JSON.parse(before.checkpoint)),
            command,
          },
          AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])]),
        );
      } finally {
        activeCompute--;
      }
      this.current();
      signal?.throwIfAborted();
      const checkpoint = JSON.stringify(response.checkpoint);
      if (Buffer.byteLength(checkpoint) > limits.checkpointBytes)
        throw new Error("Workspace checkpoint exceeds storage budget.");
      const result = JSON.stringify(response.result);
      this.db.transaction(() => {
        this.current();
        const state = this.state();
        if (state.revision !== before.revision)
          throw new InputError("Workspace changed during execution.", 409);
        this.db
          .query("INSERT INTO executions VALUES(?,?,?)")
          .run(operationId, fingerprint, result);
        this.db
          .query(
            "UPDATE workspace SET checkpoint=?, revision=revision+?, receipt_bytes=receipt_bytes+? WHERE id=1 AND epoch=?",
          )
          .run(
            response.result.committed ? checkpoint : state.checkpoint,
            // Only real content changes invalidate listings and pending downloads.
            response.result.committed && checkpoint !== state.checkpoint
              ? 1
              : 0,
            Buffer.byteLength(result) + Buffer.byteLength(operationId) + 64,
            this.epoch,
          );
      })();
      return response.result;
    });
    this.tail = run.catch(() => {});
    return run.finally(() => {
      this.queued--;
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stop.abort();
    await this.tail;
    this.db.close();
  }
}
