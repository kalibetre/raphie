import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { Context } from "@earendil-works/chord";
import { ExecutionError, FileError } from "@earendil-works/pi-durable/env";

import { containerLimits } from "./container-cli.ts";
import { decodeWire, encodeWire } from "./container-wire.ts";

type Response = {
  id: number;
  result?: unknown;
  failure?: string;
  event?: string;
  value?: unknown;
};

/** One untrusted guest transport. It has no authority over leases or host paths. */
export class ContainerRpc {
  private next = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly events = new Map<
    number,
    (kind: string, value: unknown) => void
  >();
  private readonly watcherEvents = new Map<number, number>();
  private readonly lines;

  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > containerLimits.rpcBytes)
        this.fail(new Error("Sandbox RPC output limit exceeded"));
    });
    // Drain stderr without retaining guest-controlled unbounded output.
    child.stderr.on("data", () => {});
    this.lines.on("line", (line) => {
      try {
        const response = decodeWire(JSON.parse(line)) as Response;
        if (response.event) {
          this.events.get(response.id)?.(response.event, response.value);
          return;
        }
        const pending = this.pending.get(response.id);
        this.pending.delete(response.id);
        if (response.failure) pending?.reject(new Error(response.failure));
        else pending?.resolve(response.result);
        // Bound the aggregate framing budget per completed request too.
        bytes = 0;
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.on("error", (error) => this.fail(error));
    child.on("exit", () =>
      this.fail(
        new Error(
          "Sandbox connection lost; operation interrupted (outcome unknown)",
        ),
      ),
    );
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGKILL");
    this.lines.close();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.events.clear();
    this.watcherEvents.clear();
  }

  close() {
    this.fail(new Error("Sandbox connection closed"));
  }

  async call(
    method: string,
    args: unknown[],
    cwd: string,
    context: Context,
    event?: (kind: string, value: unknown) => void,
    resource?: number,
  ): Promise<unknown> {
    if (this.closed)
      throw new Error("Sandbox resource was closed or interrupted");
    context.abortSignal?.throwIfAborted();
    const id = ++this.next;
    if (event) this.events.set(id, event);
    const cancel = () =>
      this.child.stdin.write(JSON.stringify({ id, cancel: true }) + "\n");
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(
        JSON.stringify(encodeWire({ id, method, args, cwd, resource })) + "\n",
      );
    });
    context.abortSignal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await promise;
      const opened = result as
        { ok?: boolean; value?: { $resource?: number } } | undefined;
      if (method === "watch" && opened?.ok && opened.value?.$resource)
        this.watcherEvents.set(opened.value.$resource, id);
      else this.events.delete(id);
      if (method === "close" && resource !== undefined) {
        const eventId = this.watcherEvents.get(resource);
        if (eventId !== undefined) this.events.delete(eventId);
        this.watcherEvents.delete(resource);
      }
      if (result && typeof result === "object" && "ok" in result) {
        const response = result as {
          ok: boolean;
          error?: { code: FileError["code"]; message: string; path?: string };
        };
        if (!response.ok && response.error)
          return {
            ok: false,
            error:
              method === "exec"
                ? new ExecutionError(
                    response.error.code as ExecutionError["code"],
                    response.error.message,
                  )
                : new FileError(
                    response.error.code,
                    response.error.message,
                    response.error.path,
                  ),
          };
      }
      return result;
    } finally {
      context.abortSignal?.removeEventListener("abort", cancel);
    }
  }
}
