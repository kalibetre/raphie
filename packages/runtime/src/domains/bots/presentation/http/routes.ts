import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotProfiles } from "../../application/ports.ts";

const profile = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    soul: z.string().trim().min(1).max(16000),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
  })
  .strict();

/** Owner management surface, behind the host's local access middleware; not a model tool. */
export function botRoutes(bots: BotProfiles) {
  return new Hono()
    .get("/", (c) => c.json({ items: bots.list() }))
    .post("/", limitBody(100_000), jsonInput(profile), async (c) =>
      c.json(await bots.create(c.req.valid("json")), 201),
    )
    .get("/:id/profile", (c) => c.json(bots.read(c.req.param("id"))))
    .post(
      "/:id/profile",
      limitBody(100_000),
      jsonInput(profile.extend({ revision: z.number().int().positive() })),
      async (c) =>
        c.json(await bots.update(c.req.param("id"), c.req.valid("json"))),
    )
    .get("/:id/history", (c) =>
      c.json({ items: bots.history(c.req.param("id")) }),
    )
    .get("/:id/soul.md", (c) => {
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="SOUL.md"');
      return c.body(bots.read(c.req.param("id")).soul);
    });
}
