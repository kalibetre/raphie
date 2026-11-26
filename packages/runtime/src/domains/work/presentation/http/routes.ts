import { Hono } from "hono";

import { InputError } from "../../../../shared/application/input-error.ts";
import type { WorkService } from "../../infrastructure/work-items.ts";

/** The owner reads a bot's work items: open ones, or closed with `status=closed`. */
export function workRoutes(work: WorkService) {
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
    });
}
