import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import type { WorkService } from "../../infrastructure/work-items.ts";

/** What the owner sends; the runtime cuts text that is too long. */
const text = (max: number) => z.string().max(max);

/** The owner reads and keeps a bot's work items. */
export function workRoutes(work: WorkService) {
  const answer = async (result: Promise<unknown>, created = false) => {
    const item = await result;
    if (typeof item === "string")
      throw new InputError(item, item.startsWith("No work item") ? 404 : 409);
    return { item, status: created ? 201 : 200 } as const;
  };
  return new Hono()
    .get("/", async (c) =>
      c.json({
        items: await work.list({
          open: c.req.query("status") !== "closed",
          query: c.req.query("q"),
        }),
      }),
    )
    .get("/:id", async (c) => {
      const item = await work.get(c.req.param("id"));
      if (!item) throw new InputError("Work item not found.", 404);
      return c.json(item);
    })
    .post("/:id/cancel", async (c) => {
      await work.cancel(c.req.param("id"));
      return c.json({ cancelled: true });
    })
    .post(
      "/",
      limitBody(16_384),
      jsonInput(
        z
          .object({
            title: text(400).min(1),
            notes: text(8_000).optional(),
            status: z.enum(["active", "deferred"]).optional(),
          })
          .strict(),
      ),
      async (c) => {
        const { item, status } = await answer(
          work.open(c.req.valid("json")),
          true,
        );
        return c.json(item, status);
      },
    )
    .patch(
      "/:id",
      limitBody(16_384),
      jsonInput(
        z
          .object({
            title: text(400).min(1).optional(),
            status: z
              .enum(["active", "waiting", "deferred", "done", "dropped"])
              .optional(),
            waitingOn: text(400).optional(),
            notes: text(8_000).optional(),
          })
          .strict(),
      ),
      async (c) => {
        const { item } = await answer(
          work.change(c.req.param("id"), c.req.valid("json")),
        );
        return c.json(item);
      },
    );
}
