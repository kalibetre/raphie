import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { InputError } from "../../shared/application/input-error.ts";

function webOrigins(webOrigin?: string) {
  if (!webOrigin) return [];
  const origins = [webOrigin];
  const alias = new URL(webOrigin);
  if (["127.0.0.1", "localhost"].includes(alias.hostname)) {
    alias.hostname = alias.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.push(alias.origin);
  }
  return origins;
}

export function localAccess(
  port: () => number,
  webOrigin?: string,
): MiddlewareHandler {
  return async (c, next) => {
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!hosts.includes(c.req.header("host") ?? ""))
      throw new InputError("Unrecognized host.", 403);
    const origin = c.req.header("origin");
    const origins = [
      ...hosts.map((h) => `http://${h}`),
      ...webOrigins(webOrigin),
    ];
    if (origin && !origins.includes(origin))
      throw new InputError("Unrecognized request origin.", 403);
    if (
      !["GET", "OPTIONS"].includes(c.req.method) &&
      c.req.header("x-raphie-client") !== "web"
    )
      throw new InputError("Unrecognized request origin.", 403);
    await next();
  };
}

export function browserCors(webOrigin?: string) {
  const origins = webOrigins(webOrigin);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : ""),
    allowHeaders: ["content-type", "x-raphie-client"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  });
}
