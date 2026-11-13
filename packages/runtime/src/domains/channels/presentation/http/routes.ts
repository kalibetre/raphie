import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotChannels } from "../../infrastructure/bot-channels.ts";
import type { BotTelegram } from "../../infrastructure/bot-telegram.ts";

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

const telegram = z
  .object({
    botToken: z
      .string()
      .trim()
      .regex(/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/, "Enter a valid bot token.")
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const telegramUser = z
  .object({
    userId: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/),
  })
  .strict();

export function channelRoutes(channels: BotChannels, bot?: BotTelegram) {
  const routes = new Hono()
    .get("/", (c) =>
      c.json({ ...channels.read(), telegram: bot?.read().telegram ?? null }),
    )
    .post("/discord", limitBody(4096), jsonInput(discord), async (c) =>
      c.json(await channels.save(c.req.valid("json"))),
    )
    .post("/discord/remove", async (c) => c.json(await channels.remove()));
  if (bot)
    routes
      .post("/telegram", limitBody(4096), jsonInput(telegram), async (c) =>
        c.json(await bot.save(c.req.valid("json"))),
      )
      .post("/telegram/pairing", (c) => c.json(bot.pairingCode()))
      .post("/telegram/unpair", limitBody(1024), jsonInput(telegramUser), (c) =>
        bot.unpair(c.req.valid("json").userId).then((state) => c.json(state)),
      )
      .post("/telegram/remove", async (c) => c.json(await bot.remove()));
  return routes;
}
