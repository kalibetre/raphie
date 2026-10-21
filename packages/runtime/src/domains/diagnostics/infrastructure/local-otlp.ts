import { Hono } from "hono";
import { ZodError } from "zod";

import { limitBody } from "../../../infrastructure/http/validation.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import { SqliteTraces } from "./sqlite-traces.ts";

/** Private process-owned JSON OTLP endpoint; no public collector deployment. */
export async function openLocalOtlp(
  path: string,
  serviceName = "raphie-runtime",
) {
  const traces = await SqliteTraces.open(path, { serviceName });
  try {
    const app = new Hono();
    let port = 0;
    app.use("*", async (c, next) => {
      if (
        c.req.header("origin") ||
        ![`127.0.0.1:${port}`, `localhost:${port}`].includes(
          c.req.header("host") ?? "",
        )
      )
        return c.json({ error: "Forbidden collector request." }, 403);
      return next();
    });
    app.onError((error, c) => {
      const invalid = error instanceof ZodError || error instanceof InputError;
      return c.json(
        {
          error: invalid
            ? "Invalid OTLP JSON payload."
            : "Trace storage unavailable.",
        },
        invalid ? 400 : 503,
      );
    });
    app.post("/v1/traces", limitBody(4 * 1024 * 1024), async (c) => {
      if (
        c.req.header("content-type")?.split(";")[0]?.trim() !==
        "application/json"
      )
        return c.json({ error: "Only OTLP JSON is supported." }, 415);
      let payload: unknown;
      try {
        payload = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON." }, 400);
      }
      traces.ingest(payload);
      return c.json({});
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: app.fetch,
    });
    port = server.port!;
    return {
      traces,
      endpoint: `http://127.0.0.1:${port}/v1/traces`,
      async close() {
        await server.stop(true);
        traces.close();
      },
    };
  } catch (error) {
    traces.close();
    throw error;
  }
}
