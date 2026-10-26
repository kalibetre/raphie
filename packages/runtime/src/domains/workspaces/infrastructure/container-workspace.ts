import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Context } from "@earendil-works/chord";
import {
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputInfo,
} from "@earendil-works/pi-durable/env";

import { ContainerCli, containerLimits as limits } from "./container-cli.ts";
import { ContainerRpc } from "./container-rpc.ts";
import { encodeWire, envMethods } from "./container-wire.ts";

type Options = {
  /** Trusted bot data directory: default <data>, named <data>/bots/<id>. */
  directory: string;
  workspaceId: string;
  idleMinutes: number;
  diskQuotaMiB: number | null;
  cli?: ContainerCli;
  image?: string;
  namePrefix?: string;
  now?: () => number;
};

type Lease = {
  epoch: number;
  scope: string;
  workspace_id: string;
  container: string | null;
};

type Receipt = {
  id: string;
  epoch: number;
  method: string;
  status: "running" | "completed" | "interrupted";
  fingerprint: string;
  result: string | null;
};

const runningContainers = new Set<string>();
let runningCommands = 0;
let guestSource: Promise<string> | undefined;

async function bundleGuest() {
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL("./container-guest.ts", import.meta.url)),
    ],
    target: "node",
    format: "esm",
    minify: true,
  });
  if (!build.success)
    throw new AggregateError(build.logs, "Cannot build sandbox guest");
  return build.outputs[0]!.text();
}

/** Host-owned control store. Only files/ is mounted; journal and epochs are siblings.
 * Bridge networking does NOT deny host/LAN/metadata access. CLI flags alone do
 * not implement internet-only egress on OrbStack/Desktop/Linux; see the guide.
 */
export class ContainerWorkspace {
  private readonly cli: ContainerCli;
  private readonly now: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private connection?: ContainerRpc;
  private container?: string;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private lastUsed: number;
  private lifecycleError?: Error;

  private readonly options: Options;
  private readonly db: Database;
  private readonly epoch: number;
  private readonly scope: string;
  private readonly source: string;

  private constructor(
    options: Options,
    db: Database,
    epoch: number,
    scope: string,
    source: string,
  ) {
    this.options = options;
    this.db = db;
    this.epoch = epoch;
    this.scope = scope;
    this.source = source;
    this.cli = options.cli ?? new ContainerCli();
    this.now = options.now ?? Date.now;
    this.lastUsed = this.now();
  }

  static async open(options: Options) {
    if (
      !options.workspaceId ||
      !Number.isInteger(options.idleMinutes) ||
      options.idleMinutes < 1 ||
      options.idleMinutes > 1440 ||
      (options.diskQuotaMiB !== null &&
        (!Number.isSafeInteger(options.diskQuotaMiB) ||
          options.diskQuotaMiB <= 0))
    )
      throw new Error("Invalid container workspace settings");
    if (!/^raphie(?:-test)?$/.test(options.namePrefix ?? "raphie"))
      throw new Error("Invalid Raphie container prefix");
    if (options.directory.includes(","))
      throw new Error("Container data directory cannot contain a comma");
    const source = await (guestSource ??= bundleGuest());
    const root = join(options.directory, "workspace");
    await mkdir(join(root, "files"), { recursive: true, mode: 0o700 });
    const path = join(root, "container.sqlite");
    const db = new Database(path, { strict: true });
    try {
      await chmod(path, 0o600);
      db.exec(`PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, scope TEXT NOT NULL, workspace_id TEXT NOT NULL, container TEXT);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT);`);
      db.query("INSERT OR IGNORE INTO lease VALUES(1,0,?,?,NULL)").run(
        crypto.randomUUID(),
        options.workspaceId,
      );
      const cli = options.cli ?? new ContainerCli();
      const lease = db
        .transaction(() => {
          const previous = db.query<Lease, []>("SELECT * FROM lease").get()!;
          if (previous.workspace_id !== options.workspaceId)
            throw new Error("Workspace identity changed");
          // Synchronous lifecycle calls under the same SQLite write lock as exec
          // admission close the check/launch race across processes. Kill the old
          // mount writers BEFORE publishing the new epoch, including escaped PGs.
          cli.removeOwned(options.workspaceId, previous.scope);
          if (previous.container) runningContainers.delete(previous.container);
          db.exec(
            "UPDATE commands SET status='interrupted' WHERE status='running'",
          );
          db.exec("UPDATE lease SET epoch=epoch+1, container=NULL");
          return { ...previous, epoch: previous.epoch + 1 };
        })
        .immediate();
      return new ContainerWorkspace(
        options,
        db,
        lease.epoch,
        lease.scope,
        source,
      );
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private current() {
    if (
      this.closed ||
      this.db.query<Lease, []>("SELECT * FROM lease").get()?.epoch !==
        this.epoch
    )
      throw new Error("Workspace executor was replaced or stopped");
    if (this.lifecycleError) {
      // A failed reap is fail-closed until the daemon accepts a retry. Check the
      // epoch first so a stale provider can never restart lifecycle work.
      if (this.container) this.removeContainer(this.container);
      this.lifecycleError = undefined;
    }
  }

  private removeContainer(id: string) {
    // Never remove a newer owner's container from a stale abort/close callback.
    try {
      if (this.cli.owned(this.options.workspaceId, this.scope).includes(id))
        this.cli.run(["rm", "-f", id]);
    } catch (error) {
      // Every failed reap must block admission, including transport loss without
      // a timeout/abort. Descendants may still be writing to the mounted files.
      this.lifecycleError =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    runningContainers.delete(id);
    if (this.container === id) {
      this.connection?.close();
      this.connection = undefined;
      this.container = undefined;
    }
  }

  private ensureContainer() {
    this.current();
    if (this.container) {
      if (this.connection?.isClosed)
        this.connection = new ContainerRpc(
          this.cli.exec(this.container, this.source),
        );
      return this.container;
    }
    if (runningContainers.size >= limits.containers)
      throw new Error(
        "Container capacity is busy. Retry after an idle container stops",
      );
    const id = this.cli.run([
      "create",
      "--name",
      `${this.options.namePrefix ?? "raphie"}-${this.scope}-${this.epoch}`,
      "--label",
      `raphie.workspace=${this.options.workspaceId}`,
      "--label",
      `raphie.scope=${this.scope}`,
      "--label",
      `raphie.epoch=${this.epoch}`,
      "--user",
      `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--init",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--memory",
      String(limits.memoryBytes),
      "--cpus",
      String(limits.cpus),
      "--pids-limit",
      String(limits.pids),
      "--network",
      "bridge",
      "--mount",
      `type=bind,source=${join(this.options.directory, "workspace", "files")},target=/workspace`,
      // Override Docker client proxy auto-injection: host proxy credentials must
      // never become environment variables in the guest.
      ...[
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "FTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "ftp_proxy",
        "all_proxy",
        "no_proxy",
      ].flatMap((key) => ["--env", `${key}=`]),
      "--workdir",
      "/workspace",
      this.options.image ??
        process.env.RAPHIE_CONTAINER_IMAGE ??
        "raphie-workspace:slice2",
      "sleep",
      "infinity",
    ]);
    this.container = id;
    this.db.query("UPDATE lease SET container=? WHERE id=1").run(id);
    try {
      this.cli.run(["start", id]);
      runningContainers.add(id);
      this.lastUsed = this.now();
      this.connection = new ContainerRpc(this.cli.exec(id, this.source));
      return id;
    } catch (error) {
      this.removeContainer(id);
      throw error;
    }
  }

  /** Every session receives a view with this workspace's stable namespace id. */
  env(
    cwd = "/workspace",
    operationId?: string,
    observation = false,
  ): ExecutionEnv {
    let sequence = 0;
    const nextId = () =>
      operationId ? `${operationId}:${++sequence}` : crypto.randomUUID();
    const target = { id: this.options.workspaceId, cwd };
    return new Proxy(target, {
      get: (object, property) => {
        // A view does not own the shared provider. Only bootstrap calls close().
        if (property === "cleanup") return async () => {};
        if (
          typeof property === "string" &&
          (envMethods as readonly string[]).includes(property)
        )
          return (...args: unknown[]) => {
            const context = args.pop() as Context;
            return this.invoke(
              nextId(),
              property,
              args,
              object.cwd,
              context,
              undefined,
              observation,
              operationId !== undefined,
            );
          };
        return Reflect.get(object, property);
      },
    }) as ExecutionEnv;
  }

  /** Stable host-issued ids permit receipt lookup; interrupted intents never replay. */
  execute(
    operationId: string,
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    return this.invoke(
      operationId,
      "exec",
      [command, options],
      "/workspace",
      context,
    ) as Promise<Result<ShellExecResult, ExecutionError>>;
  }

  private invoke(
    id: string,
    method: string,
    args: unknown[],
    cwd: string,
    context: Context,
    resource?: { rpc: ContainerRpc; id: number },
    observation = false,
    retainReceipt = true,
  ): Promise<unknown> {
    const failure = (error: unknown) =>
      err(
        method === "exec"
          ? new ExecutionError(
              context.abortSignal?.aborted ? "aborted" : "unknown",
              String(error),
            )
          : new FileError(
              context.abortSignal?.aborted ? "aborted" : "unknown",
              String(error),
            ),
      );
    if (this.queued >= limits.queued)
      return Promise.resolve(failure("Workspace queue is full"));
    this.queued++;
    const result = this.tail.then(async () => {
      this.current();
      if (
        resource &&
        (resource.rpc.isClosed || resource.rpc !== this.connection)
      )
        return method === "close"
          ? undefined
          : err(new FileError("invalid", "Sandbox resource is closed"));
      context.abortSignal?.throwIfAborted();
      const journal =
        !observation &&
        (method === "exec" ||
          [
            "writeFile",
            "appendFile",
            "truncateFile",
            "flushFile",
            "renameFile",
            "createDir",
            "remove",
            "createTempDir",
            "createTempFile",
          ].includes(method));
      const fingerprint = new Bun.CryptoHasher("sha256")
        .update(JSON.stringify([method, args, cwd]))
        .digest("hex");
      const receipt = this.db
        .query<Receipt, [string]>("SELECT * FROM commands WHERE id=?")
        .get(id);
      if (journal && receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new Error("Conflicting sandbox operation retry");
        if (receipt.status !== "completed")
          throw new Error(
            "Command interrupted; outcome unknown. Inspect files before continuing; it will not be replayed",
          );
        const saved = JSON.parse(receipt.result!) as {
          response: {
            ok: boolean;
            error?: { code: ExecutionError["code"]; message: string };
          };
          output: { text: string; info: ShellOutputInfo }[];
        };
        try {
          const options = args[1] as ShellExecOptions | undefined;
          for (const output of saved.output)
            options?.onOutput?.(output.text, context, output.info);
        } catch {
          return err(
            new ExecutionError(
              "callback_error",
              "Saved sandbox output callback failed",
            ),
          );
        }
        if (!saved.response.ok && saved.response.error)
          return err(
            new ExecutionError(
              saved.response.error.code,
              saved.response.error.message,
            ),
          );
        return saved.response;
      }
      if (
        method === "exec" &&
        Buffer.byteLength(JSON.stringify(args[0])) > limits.sourceBytes
      )
        throw new Error("Sandbox command exceeds the 16 KiB source limit");
      if (
        journal &&
        this.db
          .query<{ count: number }, []>(
            "SELECT count(*) AS count FROM commands",
          )
          .get()!.count >= limits.journalEntries
      )
        throw new Error(
          "Sandbox command journal is full. Preserve and archive it before continuing",
        );
      if (runningCommands >= limits.concurrent)
        throw new Error("Container command capacity is busy. Retry later");
      runningCommands++;
      let container: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancelled: Error | undefined;
      let abort: (() => void) | undefined;
      try {
        this.db
          .transaction(() => {
            this.current();
            container = this.ensureContainer();
          })
          .immediate();
        const rpc =
          resource?.rpc ??
          (method === "exec"
            ? new ContainerRpc(this.cli.exec(container!, this.source))
            : this.connection!);
        const cancel = (reason: Error) => {
          cancelled = reason;
          // Killing the container is stronger than PG kill: even a daemon that
          // calls setsid cannot survive a timeout/abort. Files already written stay.
          try {
            this.removeContainer(container!);
          } catch (error) {
            this.lifecycleError =
              error instanceof Error ? error : new Error(String(error));
          } finally {
            rpc.close();
          }
        };
        abort = () =>
          cancel(
            new ExecutionError(
              "aborted",
              "Sandbox command aborted; outcome unknown",
            ),
          );
        context.abortSignal?.addEventListener("abort", abort, { once: true });
        const options =
          method === "exec"
            ? (args[1] as ShellExecOptions | undefined)
            : undefined;
        if (
          options?.timeout !== undefined &&
          (!Number.isFinite(options.timeout) || options.timeout <= 0)
        )
          throw new Error("Invalid command timeout");
        timer = setTimeout(
          () =>
            cancel(
              new ExecutionError(
                "timeout",
                "Sandbox command timed out; outcome unknown",
              ),
            ),
          Math.min(
            limits.timeoutMs,
            (options?.timeout ?? limits.timeoutMs / 1000) * 1000,
          ),
        );
        let outputBytes = 0;
        const outputEvents: { text: string; info: ShellOutputInfo }[] = [];
        const callback =
          method === "watch"
            ? (args[1] as (change: unknown) => void)
            : undefined;
        const event = (kind: string, value: unknown) => {
          this.current();
          if (kind === "change") {
            // An observer is not part of the transport. A broken UI callback
            // must not close readers or the guest shared by other sessions.
            try {
              callback?.(value);
            } catch {
              /* Listener failure is local. */
            }
            return;
          }
          const output = value as {
            text: string;
            info: ShellOutputInfo;
          };
          outputBytes += Buffer.byteLength(output.text);
          if (outputBytes > limits.outputBytes) {
            cancel(
              new ExecutionError(
                "unknown",
                "Sandbox output cap exceeded; command interrupted",
              ),
            );
            return;
          }
          if (method === "exec") outputEvents.push(output);
          try {
            options?.onOutput?.(output.text, context, output.info);
          } catch {
            cancel(
              new ExecutionError(
                "callback_error",
                "Sandbox output callback failed",
              ),
            );
          }
        };
        if (
          !observation &&
          this.options.diskQuotaMiB !== null &&
          [
            "exec",
            "writeFile",
            "appendFile",
            "truncateFile",
            "createDir",
            "createTempDir",
            "createTempFile",
          ].includes(method)
        ) {
          let usage = "";
          const checked = (await this.connection!.call(
            "exec",
            [["du", "-sk", "/workspace"], {}],
            cwd,
            context,
            (_kind, value) => {
              usage += (value as { text: string }).text;
            },
          )) as { ok: boolean; value?: ShellExecResult };
          if (!checked.ok || checked.value?.exitCode !== 0)
            throw new Error("Cannot check workspace disk quota");
          const usedKiB = Number.parseInt(usage, 10);
          if (!Number.isFinite(usedKiB) || usedKiB < 0)
            throw new Error("Invalid workspace disk usage");
          if (usedKiB > this.options.diskQuotaMiB * 1024)
            throw new Error(
              "Workspace disk quota exceeded. Remove files or increase diskQuotaMiB before running commands",
            );
        }
        // Persist intent BEFORE submitting anything that can mutate workspace files.
        this.db
          .transaction(() => {
            this.current();
            if (journal)
              this.db
                .query("INSERT INTO commands VALUES(?,?,?,'running',?,NULL)")
                .run(id, this.epoch, method, fingerprint);
          })
          .immediate();
        let response: unknown;
        try {
          const transportArgs = method === "watch" ? [args[0], null] : args;
          response = await rpc.call(
            method,
            transportArgs,
            cwd,
            context,
            event,
            resource?.id,
          );
          if (cancelled) throw cancelled;
          this.db
            .transaction(() => {
              this.current();
              if (journal && !retainReceipt)
                this.db
                  .query("DELETE FROM commands WHERE id=? AND epoch=?")
                  .run(id, this.epoch);
              else if (journal)
                this.db
                  .query(
                    "UPDATE commands SET status='completed', result=? WHERE id=? AND epoch=?",
                  )
                  .run(
                    JSON.stringify(
                      encodeWire({ response, output: outputEvents }),
                    ),
                    id,
                    this.epoch,
                  );
            })
            .immediate();
        } catch (error) {
          // Connection loss can leave descendants. Reap before accepting new work.
          this.removeContainer(container!);
          this.db
            .transaction(() => {
              this.current();
              if (journal)
                this.db
                  .query(
                    "UPDATE commands SET status='interrupted' WHERE id=? AND epoch=?",
                  )
                  .run(id, this.epoch);
            })
            .immediate();
          throw cancelled ?? error;
        } finally {
          if (method === "exec") rpc.close();
        }
        if (response && typeof response === "object" && "ok" in response) {
          const opened = response as {
            ok: boolean;
            value?: { $resource?: number; mode?: string };
          };
          if (
            [
              "openBinaryReader",
              "openDirReader",
              "openTextLineReader",
              "watch",
            ].includes(method) &&
            opened.ok &&
            opened.value?.$resource
          ) {
            const resourceId = opened.value.$resource;
            return {
              ok: true,
              value: new Proxy(
                { mode: opened.value.mode },
                {
                  get: (object, key) => {
                    if (key === "mode") return object.mode;
                    return (...values: unknown[]) => {
                      const callContext = values.pop() as Context;
                      return this.invoke(
                        crypto.randomUUID(),
                        String(key),
                        values,
                        cwd,
                        callContext,
                        { rpc, id: resourceId },
                        observation,
                        retainReceipt,
                      );
                    };
                  },
                },
              ),
            };
          }
        }
        return response;
      } catch (error) {
        if (error instanceof ExecutionError) return err(error);
        throw error;
      } finally {
        clearTimeout(timer);
        if (abort) context.abortSignal?.removeEventListener("abort", abort);
        runningCommands--;
        if (!observation) this.lastUsed = this.now();
        this.scheduleIdle();
      }
    });
    this.tail = result.catch(() => {});
    return result.catch(failure).finally(() => {
      this.queued--;
    });
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.closed && this.container) {
      this.idleTimer = setTimeout(
        () => {
          void this.stopIfIdle().catch((error: unknown) => {
            this.lifecycleError =
              error instanceof Error ? error : new Error(String(error));
          });
        },
        Math.max(
          1,
          this.options.idleMinutes * 60_000 - (this.now() - this.lastUsed),
        ),
      );
      this.idleTimer.unref();
    }
  }

  /** Injectable clock plus explicit sweep makes idle expiry deterministic in tests. */
  async stopIfIdle() {
    await this.tail;
    if (this.closed || !this.container || this.queued) return;
    if (this.now() - this.lastUsed < this.options.idleMinutes * 60_000) {
      this.scheduleIdle();
      return;
    }
    try {
      this.current();
    } catch {
      return;
    }
    this.removeContainer(this.container);
  }

  history() {
    this.current();
    return this.db
      .query<Receipt, []>("SELECT * FROM commands ORDER BY rowid")
      .all();
  }

  get admitted() {
    return this.queued;
  }

  async usage(context: Context) {
    let output = "";
    const result = await this.env("/workspace", undefined, true).exec(
      ["du", "-sk", "/workspace"],
      {
        onOutput: (text) => {
          output += text;
        },
      },
      context,
    );
    const kib = Number.parseInt(output, 10);
    if (
      !result.ok ||
      result.value.exitCode !== 0 ||
      !Number.isFinite(kib) ||
      kib < 0
    )
      throw new Error("Cannot measure container workspace usage");
    return kib * 1024;
  }

  async close() {
    if (this.closed) return;
    clearTimeout(this.idleTimer);
    // Set closed before reaping so queued views cannot start more work.
    this.closed = true;
    try {
      if (this.container) this.removeContainer(this.container);
    } finally {
      if (this.container) runningContainers.delete(this.container);
      this.connection?.close();
      await this.tail;
      this.db.close();
    }
  }
}
