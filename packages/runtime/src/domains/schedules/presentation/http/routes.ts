import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotJobs } from "../../infrastructure/bot-jobs.ts";

export function jobRoutes(jobs: BotJobs) {
  return new Hono()
    .get("/", async (c) => c.json({ items: await jobs.read() }))
    .post(
      "/",
      limitBody(20_000),
      jsonInput(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            prompt: z.string().trim().min(1).max(4000),
            everyMinutes: z.number().int().min(1).max(525600),
            firstRunAt: z.number().int().min(0).max(8640000000000000),
          })
          .strict(),
      ),
      async (c) => c.json({ items: await jobs.add(c.req.valid("json")) }, 201),
    )
    .post(
      "/:id",
      limitBody(1024),
      jsonInput(
        z
          .object({ action: z.enum(["enable", "disable", "remove", "run"]) })
          .strict(),
      ),
      async (c) =>
        c.json({
          items: await jobs.change(
            c.req.param("id"),
            c.req.valid("json").action,
          ),
        }),
    );
}
