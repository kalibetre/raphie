import { Hono } from "hono";

import { InputError } from "../../../../shared/application/input-error.ts";
import type { TraceReader } from "../../application/trace-reader.ts";

export function diagnosticsRoutes(traces: TraceReader) {
  return new Hono().get("/traces", async (c) => {
    const hours = Number(c.req.query("hours") ?? "1");
    if (hours !== 1 && hours !== 6 && hours !== 24)
      throw new InputError("Choose a 1, 6 or 24 hour trace window.");
    return c.json(await traces.read(hours));
  });
}
