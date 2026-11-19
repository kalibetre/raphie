import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotHandoffs } from "../../infrastructure/bot-handoffs.ts";

/** One bot's handoffs: the bots it may hand tasks to, and the tasks it handed off. */
export function handoffRoutes(handoffs: BotHandoffs) {
  return new Hono()
    .get("/", async (c) =>
      c.json({
        targets: handoffs.targets(),
        items: (await handoffs.read()).reverse(),
      }),
    )
    .put(
      "/targets",
      limitBody(20_000),
      jsonInput(
        z
          .object({ bots: z.array(z.string().min(1).max(100)).max(100) })
          .strict(),
      ),
      async (c) =>
        c.json({
          targets: await handoffs.setTargets(c.req.valid("json").bots),
        }),
    )
    .post("/:id/cancel", async (c) => {
      await handoffs.cancel(c.req.param("id"));
      return c.json({ ok: true });
    });
}
