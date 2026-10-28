import { serveStatic } from "@hono/bun";
import { Hono } from "hono";

import { pairedAuth } from "../infrastructure/auth/paired-auth.ts";
import { PairingStore } from "../infrastructure/auth/pairing-store.ts";
import {
  deviceToken,
  guardEventStream,
  nativeToken,
} from "../infrastructure/auth/server-auth.ts";

/** Bun owns sockets and file responses; Start owns SSR and API proxy routes. */
export function startWebServer(options: {
  fetch: (request: Request) => Response | Promise<Response>;
  clientDirectory: string;
  port?: number;
  build?: { id: string; version: string };
  remote?: {
    origin: string;
    hostname: string;
    pairingDatabase: string;
  };
}) {
  if (options.remote) {
    if (!["127.0.0.1", "::1"].includes(options.remote.hostname))
      throw new Error("Experimental pairing must bind to a loopback address.");
  }
  const app = new Hono();
  const devices = options.remote
    ? new PairingStore(options.remote.pairingDatabase)
    : null;
  let authenticate: ReturnType<typeof pairedAuth> | null = null;
  try {
    if (options.remote && devices)
      authenticate = pairedAuth(devices, options.remote.origin);
  } catch (error) {
    devices?.close();
    throw error;
  }
  app.use("*", async (c, next) => {
    if (
      !options.remote &&
      !["127.0.0.1", "localhost"].includes(new URL(c.req.url).hostname)
    )
      return c.text("Unrecognized host.", 403);
    if (authenticate) {
      const result = await authenticate(c.req.raw);
      if (result) return result;
    }
    if (
      !options.remote &&
      c.req.path === "/auth/status" &&
      c.req.method === "GET"
    )
      return c.json({ enabled: false });
    let path: string;
    try {
      path = decodeURIComponent(c.req.path);
    } catch {
      return c.text("Invalid path.", 400);
    }
    // Preserve the previous static server's dotfile restriction.
    if (path.split("/").some((part) => part.startsWith(".")))
      return c.notFound();
    await next();
    if (options.remote) {
      const device = deviceToken(c.req.raw) || nativeToken(c.req.raw);
      c.res =
        devices && device && devices.isValid(device)
          ? guardEventStream(
              c.res,
              { valid: (token) => devices.isValid(token) },
              device,
            )
          : c.res;
    }
  });
  app.get("/_raphie/version", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(
      options.build ?? { id: "development", version: "development" },
    );
  });
  app.on(["GET", "HEAD"], "*", serveStatic({ root: options.clientDirectory }));
  app.all("*", (c) => options.fetch(c.req.raw));
  return Bun.serve({
    hostname: options.remote?.hostname ?? "127.0.0.1",
    port: options.port ?? 4320,
    idleTimeout: 0,
    maxRequestBodySize: 4 * 8 * 1024 * 1024 + 64 * 1024,
    fetch: app.fetch,
  });
}
