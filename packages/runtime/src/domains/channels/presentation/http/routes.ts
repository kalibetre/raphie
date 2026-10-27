import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotChannels } from "../../infrastructure/bot-channels.ts";

const id = z
  .string()
  .trim()
  .regex(/^\d{1,32}$/);
const discord = z
  .object({
    botToken: z.string().trim().max(512).optional(),
    allowedUserIds: z
      .array(id)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "User IDs must be unique.",
      ),
    channelId: z.union([id, z.literal("")]).optional(),
  })
  .strict();

export function channelRoutes(channels: BotChannels) {
  return new Hono()
    .get("/", (c) => c.json(channels.read()))
    .post("/discord", limitBody(4096), jsonInput(discord), async (c) =>
      c.json(await channels.save(c.req.valid("json"))),
    )
    .post("/discord/remove", async (c) => c.json(await channels.remove()));
}
