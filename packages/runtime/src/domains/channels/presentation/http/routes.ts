import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotChannels } from "../../infrastructure/bot-channels.ts";
import type { BotSlack } from "../../infrastructure/bot-slack.ts";
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

const slackUser = z
  .string()
  .trim()
  .regex(/^[UW][A-Z0-9]{2,32}$/, "Enter Slack member IDs, such as U012AB3CD.");
const slack = z
  .object({
    botToken: z
      .string()
      .trim()
      .regex(/^xoxb-[A-Za-z0-9-]{10,500}$/, "Enter a bot token (xoxb-…).")
      .optional()
      .or(z.literal("")),
    appToken: z
      .string()
      .trim()
      .regex(
        /^xapp-[A-Za-z0-9-]{10,500}$/,
        "Enter an app-level token (xapp-…).",
      )
      .optional()
      .or(z.literal("")),
    allowedUserIds: z
      .array(slackUser)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "User IDs must be unique.",
      ),
    channelId: z
      .union([
        z
          .string()
          .trim()
          .regex(
            /^[CG][A-Z0-9]{2,32}$/,
            "Enter a channel ID, such as C012AB3CD.",
          ),
        z.literal(""),
      ])
      .optional(),
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

export function channelRoutes(
  channels: BotChannels,
  bot?: BotTelegram,
  slackBot?: BotSlack,
) {
  const routes = new Hono()
    .get("/", (c) =>
      c.json({
        ...channels.read(),
        slack: slackBot?.read().slack ?? null,
        telegram: bot?.read().telegram ?? null,
      }),
    )
    .post("/discord", limitBody(4096), jsonInput(discord), async (c) =>
      c.json(await channels.save(c.req.valid("json"))),
    )
    .post("/discord/remove", async (c) => c.json(await channels.remove()));
  if (slackBot)
    routes
      .post("/slack", limitBody(4096), jsonInput(slack), async (c) =>
        c.json(await slackBot.save(c.req.valid("json"))),
      )
      .post("/slack/remove", async (c) => c.json(await slackBot.remove()));
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
