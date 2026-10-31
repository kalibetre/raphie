import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import { openAuthService } from "../infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  webOrigins,
} from "../infrastructure/auth/auth-storage.ts";
import { createGateway } from "../infrastructure/auth/gateway.ts";

type DevRequest = IncomingMessage & { originalUrl?: string };

/** Only the authentication endpoints read a body here; Start reads all others. */
function toRequest(req: DevRequest) {
  const method = req.method ?? "GET";
  const hasBody =
    method === "POST" &&
    (req.originalUrl ?? req.url ?? "").startsWith("/api/auth/");
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  return new Request(
    `http://${req.headers.host ?? "invalid.host"}${req.originalUrl ?? req.url}`,
    {
      method,
      headers,
      ...(hasBody
        ? {
            body: Readable.toWeb(req) as unknown as ReadableStream,
            duplex: "half",
          }
        : {}),
    } as RequestInit,
  );
}

function send(res: ServerResponse, response: Response) {
  const headers: Record<string, string | string[]> = Object.fromEntries(
    [...response.headers].filter(([name]) => name !== "set-cookie"),
  );
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.end();
}

/**
 * The development server gets the same gateway as the production host. It
 * runs after Vite's own module serving (so the login page can load) and
 * before Start, so every page, server function and API request is gated.
 */
export function developmentGateway(): Plugin {
  return {
    name: "raphie-gateway",
    enforce: "pre",
    async configureServer(server) {
      // Fail closed: no authentication store, no development server.
      const origins = webOrigins(process.env.RAPHIE_WEB_ORIGIN);
      const directory = authDirectory(
        fileURLToPath(new URL("../../../../", import.meta.url)),
        process.env.DATA_DIRECTORY,
      );
      const auth = await openAuthService({
        directory,
        origins,
        role: "server",
      });
      server.config.logger.info(`Authentication store: ${directory}`);
      server.httpServer?.once("close", () => auth.close());
      const gateway = createGateway({ service: auth, origins });
      if (!auth.configured())
        server.config.logger.warn(
          "Raphie is locked until an administrator is created: run `bun run raphie auth setup`.",
        );
      return () => {
        // Never let a gateway failure admit the request or end the dev server.
        server.middlewares.use((req, res, next) => {
          admit(req, res, next).catch(() => {
            if (!res.headersSent) res.statusCode = 503;
            res.end();
          });
        });

        async function admit(
          req: DevRequest,
          res: ServerResponse,
          next: () => void,
        ) {
          let request: Request;
          try {
            request = toRequest(req);
          } catch {
            return send(res, new Response("Invalid request.", { status: 400 }));
          }
          const admission = await gateway.check(request);
          if (admission instanceof Response) return send(res, admission);
          for (const cookie of admission.cookies)
            res.appendHeader("set-cookie", cookie);
          if (admission.stillValid) {
            const { stillValid } = admission;
            // Close open event streams as soon as their session is revoked.
            const timer = setInterval(() => {
              if (
                !String(res.getHeader("content-type") ?? "").startsWith(
                  "text/event-stream",
                )
              )
                return;
              void stillValid()
                .then((valid) => !valid && res.destroy())
                .catch(() => res.destroy());
            }, 2000);
            res.once("close", () => clearInterval(timer));
          }
          next();
        }
      };
    },
  };
}
