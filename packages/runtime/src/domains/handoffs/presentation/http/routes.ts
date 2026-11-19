import { Hono } from "hono";

import type { BotHandoffs } from "../../infrastructure/bot-handoffs.ts";

/** One bot's handoffs: the bots it can hand tasks to, and the tasks it handed off. */
export function handoffRoutes(handoffs: BotHandoffs) {
  return new Hono()
    .get("/", async (c) =>
      c.json({
        targets: handoffs.targets(),
        items: await handoffs.list(),
      }),
    )
    .post("/:id/cancel", async (c) => {
      await handoffs.cancel(c.req.param("id"));
      return c.json({ ok: true });
    });
}
