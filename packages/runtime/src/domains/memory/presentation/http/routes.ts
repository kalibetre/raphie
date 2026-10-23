import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { MemoryService } from "../../application/ports.ts";
import { memoryConfigurationInput } from "../../infrastructure/runtime-memory.ts";

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
      // One schema for HTTP and the service, so they cannot drift.
      jsonInput(memoryConfigurationInput),
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
