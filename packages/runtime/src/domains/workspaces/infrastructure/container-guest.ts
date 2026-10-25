import { createInterface } from "node:readline";

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

import { decodeWire, encodeWire, envMethods } from "./container-wire.ts";

// This entrypoint is bundled and sent as argv to `docker exec node`. It NEVER
// runs on the host. In particular, NodeExecutionEnv is not a host-side fallback.
const env = new NodeExecutionEnv({
  cwd: "/workspace",
  shellPath: "/bin/sh",
  shellEnv: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp" },
});
const resources = new Map<number, object>();
const controllers = new Map<number, AbortController>();
let nextResource = 0;
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(encodeWire(value)) + "\n");
const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
  const request = JSON.parse(line) as {
    id: number;
    method: string;
    args: unknown[];
    resource?: number;
    cwd: string;
    cancel?: boolean;
  };
  if (request.cancel) {
    controllers.get(request.id)?.abort();
    return;
  }
  void (async () => {
    const controller = new AbortController();
    controllers.set(request.id, controller);
    const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
    const event = (kind: string, value: unknown) =>
      send({ id: request.id, event: kind, value });
    try {
      const args = decodeWire(request.args) as unknown[];
      const target =
        request.resource === undefined ? env : resources.get(request.resource);
      const allowed =
        request.resource === undefined
          ? (envMethods as readonly string[]).includes(request.method)
          : ["info", "read", "scanLines", "readLine", "next", "close"].includes(
              request.method,
            );
      if (!target) {
        send({
          id: request.id,
          result:
            request.method === "close"
              ? undefined
              : err(new FileError("invalid", "Resource is closed")),
        });
        return;
      }
      if (!allowed) throw new Error("Invalid sandbox method");
      env.cwd = request.cwd;
      if (request.method === "watch")
        args[1] = (change: unknown) => event("change", change);
      if (request.method === "exec") {
        const options = (args[1] ?? {}) as Record<string, unknown>;
        args[1] = {
          ...options,
          inheritEnv: false,
          // The host deadline reaps the entire container, including escaped groups.
          timeout: undefined,
          onOutput: (text: string, _context: unknown, info: unknown) =>
            event("output", { text, info }),
        };
      }
      const method = (
        target as unknown as Record<string, (...args: unknown[]) => unknown>
      )[request.method]!;
      let result = await method.apply(target, [...args, context]);
      if (
        [
          "openBinaryReader",
          "openDirReader",
          "openTextLineReader",
          "watch",
        ].includes(request.method)
      ) {
        const opened = result as {
          ok: boolean;
          value: object & { mode?: string };
        };
        if (opened.ok) {
          const id = ++nextResource;
          resources.set(id, opened.value);
          result = {
            ok: true,
            value: { $resource: id, mode: opened.value.mode },
          };
        }
      }
      if (request.method === "close" && request.resource !== undefined)
        resources.delete(request.resource);
      send({ id: request.id, result });
    } catch (error) {
      send({ id: request.id, failure: String(error) });
    } finally {
      controllers.delete(request.id);
    }
  })();
});

input.on("close", () => {
  void env.cleanup(BACKGROUND_CONTEXT).finally(() => process.exit());
});
