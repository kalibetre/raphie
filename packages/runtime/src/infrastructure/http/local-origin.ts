import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { InputError } from "../../shared/application/input-error.ts";

export function localAccess(
  port: () => number,
  webOrigins: string[] = [],
): MiddlewareHandler {
  return async (c, next) => {
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!hosts.includes(c.req.header("host") ?? ""))
      throw new InputError("Unrecognized host.", 403);
    const origin = c.req.header("origin");
    const origins = [...hosts.map((h) => `http://${h}`), ...webOrigins];
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

export function browserCors(origins: string[] = []) {
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : ""),
    allowHeaders: ["content-type", "x-raphie-client"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  });
}
