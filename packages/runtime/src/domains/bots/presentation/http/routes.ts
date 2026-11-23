import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotProfiles } from "../../application/ports.ts";
import { PERSONALITY_PRESETS } from "../../domain/personalities.ts";
import { MAX_RULE_LENGTH, MAX_RULES } from "../../domain/rules.ts";

const profile = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    personality: z.string().trim().min(1).max(16000),
    replyStyle: z
      .object({
        length: z.enum(["short", "balanced", "detailed"]),
        warmth: z.enum(["plain", "default", "warm"]),
        formatting: z.enum(["prose", "default", "structured"]),
        emoji: z.boolean(),
      })
      .strict()
      .optional(),
    selfUpdates: z
      .object({
        personality: z.boolean(),
        owner: z.boolean(),
        skills: z.boolean().optional(),
      })
      .strict()
      .optional(),
    rules: z
      .array(z.string().trim().min(1).max(MAX_RULE_LENGTH))
      .max(MAX_RULES)
      .optional(),
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
    .get("/personalities", (c) => c.json({ items: PERSONALITY_PRESETS }))
    .post("/", limitBody(100_000), jsonInput(profile), async (c) =>
      c.json(await bots.create(c.req.valid("json")), 201),
    )
    .get("/:id/profile", (c) => c.json(bots.read(c.req.param("id"))))
    .delete(
      "/:id",
      limitBody(1024),
      jsonInput(
        z
          .object({
            name: z.string().min(1).max(80),
            revision: z.number().int().positive(),
          })
          .strict(),
      ),
      async (c) => {
        await bots.delete(c.req.param("id"), c.req.valid("json"));
        return c.body(null, 204);
      },
    )
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
    .get("/:id/personality.md", (c) => {
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="personality.md"');
      return c.body(bots.read(c.req.param("id")).personality);
    });
}
