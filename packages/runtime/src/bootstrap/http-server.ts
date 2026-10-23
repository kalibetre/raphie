import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { botRoutes } from "../domains/bots/presentation/http/routes.ts";
import type { TraceReader } from "../domains/diagnostics/application/trace-reader.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import type { SettingsService } from "../domains/settings/application/ports.ts";
import {
  browserCors,
  localAccess,
} from "../infrastructure/http/local-origin.ts";
import { limitBody } from "../infrastructure/http/validation.ts";
import { InputError } from "../shared/application/input-error.ts";
import type { Gateway } from "./agent-runtime.ts";
import type { BotHost } from "./bot-host.ts";
import { runtimeRoutes } from "./runtime-http-routes.ts";

export async function startServer(
  runtime: Gateway,
  options: {
    port?: number;
    discordConfigured?: boolean;
    webOrigin?: string;
    webhook?: (request: Request) => Promise<Response>;
    diagnostics?: TraceReader;
    settings?: SettingsService;
    memory?: MemoryService;
    bots?: BotHost;
  } = {},
) {
  const app = new Hono();
  let port = options.port ?? 4315;
  app.use("*", async (c, next) => {
    // Polling telemetry must not create a feedback stream of diagnostic spans.
    if (c.req.path.startsWith("/api/diagnostics/")) return next();
    return runtime.telemetry.run(
      "http.request",
      { "http.method": c.req.method },
      async (annotate) => {
        await next();
        annotate({
          "http.route": c.req.routePath,
          "http.status_code": c.res.status,
        });
      },
    );
  });
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((error, c) =>
    c.json(
      {
        code: error instanceof InputError ? error.code : "invalid_request",
        error:
          error instanceof InputError
            ? error.message
            : error instanceof HTTPException
              ? error.message
              : "Request failed. Check the request and try again.",
      },
      (error instanceof InputError || error instanceof HTTPException
        ? error.status
        : 400) as ContentfulStatusCode,
    ),
  );
  if (options.webhook) {
    const webhook = options.webhook;
    app.post("/webhooks/discord", limitBody(1024 * 1024), async (c) =>
      webhook(new Request(c.req.raw, { body: await c.req.arrayBuffer() })),
    );
  }
  app.use(
    "*",
    localAccess(() => port, options.webOrigin),
    browserCors(options.webOrigin),
  );
  app.get("/", (c) =>
    c.json({
      service: "Raphie runtime",
      web: options.webOrigin ?? "http://127.0.0.1:4320",
    }),
  );
  if (options.bots) {
    app.route("/api/bots", botRoutes(options.bots));
    const scoped = new Map<string, ReturnType<typeof runtimeRoutes>>();
    app.all("/api/bots/:botId/*", async (c) => {
      const id = c.req.param("botId");
      const bot = options.bots!.runtime(id);
      let routes = scoped.get(id);
      if (!routes) {
        routes = runtimeRoutes(bot.gateway, id === "default" ? options : bot);
        scoped.set(id, routes);
      }
      const url = new URL(c.req.url);
      url.pathname = `/api/${c.req.path.split("/").slice(4).join("/")}`;
      return routes.fetch(new Request(url, c.req.raw));
    });
  }
  app.route("/", runtimeRoutes(runtime, options));
  app.notFound((c) => c.json({ error: "Not found." }, 404));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // SSE viewers can remain idle while durable work waits for an approval.
    idleTimeout: 0,
    maxRequestBodySize: 4 * 8 * 1024 * 1024 + 64 * 1024,
    fetch: app.fetch,
  });
  port = server.port!;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await server.stop(true);
    },
  };
}

export { snapshot } from "../infrastructure/pi/workspace-snapshot.ts";
