import { serveStatic } from "@hono/bun";
import { Hono } from "hono";

/** Bun owns sockets and file responses; Start owns SSR and API proxy routes. */
export function startWebServer(options: {
  fetch: (request: Request) => Response | Promise<Response>;
  clientDirectory: string;
  port?: number;
  build?: { id: string; version: string };
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    // Without authentication, only loopback hosts may reach the app.
    if (!["127.0.0.1", "localhost"].includes(new URL(c.req.url).hostname))
      return c.text("Unrecognized host.", 403);
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
    fetch: app.fetch,
  });
}
