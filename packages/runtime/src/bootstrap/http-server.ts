import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { streamSnapshots } from "../domains/activity/presentation/http/events.ts";
import { approvalRoutes } from "../domains/approvals/presentation/http/routes.ts";
import { attachmentRoutes } from "../domains/attachments/presentation/http/routes.ts";
import { conversationRoutes } from "../domains/conversations/presentation/http/routes.ts";
import {
  browserCors,
  localAccess,
} from "../infrastructure/http/local-origin.ts";
import { limitBody } from "../infrastructure/http/validation.ts";
import { snapshot } from "../infrastructure/pi/workspace-snapshot.ts";
import { InputError } from "../shared/application/input-error.ts";
import type { Gateway } from "./agent-runtime.ts";

export async function startServer(
  runtime: Gateway,
  options: {
    port?: number;
    discordConfigured?: boolean;
    webOrigin?: string;
    webhook?: (request: Request) => Promise<Response>;
  } = {},
) {
  const app = new Hono();
  let port = options.port ?? 4315;
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
  app.get("/api/chats", async (c) => c.json(await snapshot(runtime)));
  app.get("/api/events", (c) => streamSnapshots(c, () => snapshot(runtime)));
  app.route("/api", conversationRoutes(runtime.chats));
  app.route(
    "/api",
    approvalRoutes(
      runtime.toolApprovals,
      runtime,
      runtime.files,
      options.discordConfigured ?? false,
    ),
  );
  app.route("/api", attachmentRoutes(runtime.files, runtime));
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
