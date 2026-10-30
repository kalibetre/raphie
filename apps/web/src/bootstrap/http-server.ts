import { serveStatic } from "@hono/bun";
import { Hono } from "hono";

import type { Gateway } from "../infrastructure/auth/gateway.ts";

/**
 * Bun owns sockets and file responses; Start owns SSR and API proxy routes.
 * Nothing is served before the gateway has admitted the request.
 */
export function startWebServer(options: {
  gateway: Gateway;
  fetch: (request: Request) => Response | Promise<Response>;
  clientDirectory: string;
  port?: number;
  build?: { id: string; version: string };
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
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
    hostname: "127.0.0.1",
    port: options.port ?? 4320,
    idleTimeout: 0,
    maxRequestBodySize: 4 * 8 * 1024 * 1024 + 64 * 1024,
    async fetch(request) {
      const admission = await options.gateway.check(request);
      if (admission instanceof Response) return admission;
      return options.gateway.finish(await app.fetch(request), admission);
    },
  });
}
