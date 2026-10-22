import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { MemoryService } from "../../application/ports.ts";

export function memoryRoutes(memory: MemoryService) {
  const query = z
    .object({ query: z.string().trim().min(1).max(2000) })
    .strict();
  return new Hono()
    .get("/", (c) => c.json(memory.read()))
    .get("/evidence", async (c) =>
      c.json(await memory.browse(c.req.query("after"))),
    )
    .post(
      "/",
      limitBody(8192),
      jsonInput(
        z
          .object({
            enabled: z.boolean(),
            provider: z.enum(["builtin", "hindsight"]),
            scope: z.string().max(80),
            endpoint: z.string().max(2048),
            bankId: z.string().max(80),
            apiKey: z.string().max(4096).nullable().optional(),
          })
          .strict(),
      ),
      async (c) => c.json(await memory.configure(c.req.valid("json"))),
    )
    .post(
      "/test",
      limitBody(1024),
      jsonInput(z.object({}).strict()),
      async (c) => {
        await memory.test();
        return c.json({ connected: true });
      },
    )
    .post("/recall", limitBody(8192), jsonInput(query), async (c) =>
      c.json(await memory.recall(c.req.valid("json").query)),
    )
    .post(
      "/evidence/:id",
      limitBody(16_384),
      jsonInput(
        z.object({ content: z.string().trim().min(1).max(8000) }).strict(),
      ),
      async (c) => {
        await memory.revise(c.req.param("id"), c.req.valid("json").content);
        return c.json({ updated: true });
      },
    )
    .post(
      "/evidence/:id/forget",
      limitBody(1024),
      jsonInput(z.object({}).strict()),
      async (c) => {
        await memory.forget(c.req.param("id"));
        return c.json({ forgotten: true });
      },
    );
}
