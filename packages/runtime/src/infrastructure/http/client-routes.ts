import { Hono } from "hono";

import type { ActorContext } from "../../application/access/actors.ts";
import type { ClientQueries } from "../../application/queries/ports.ts";
import { streamSnapshots } from "../../domains/activity/presentation/http/events.ts";

/** Local access middleware runs before these routes and establishes the actor. */
export function clientRoutes(queries: ClientQueries, actor: ActorContext) {
  return new Hono()
    .get("/runtime", async (c) => c.json(await queries.info(actor)))
    .get("/sessions", async (c) =>
      c.json(
        await queries.sessions(
          actor,
          c.req.query("after"),
          c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
        ),
      ),
    )
    .get("/sessions/events", (c) =>
      streamSnapshots(c, () => queries.sessions(actor, undefined, 100)),
    )
    .get("/sessions/legacy/:id", async (c) =>
      c.json({
        sessionId: await queries.resolveLegacy(
          actor,
          Number(c.req.param("id")),
        ),
      }),
    )
    .get("/sessions/:id", async (c) =>
      c.json(await queries.session(actor, c.req.param("id"))),
    )
    .get("/sessions/:id/history", async (c) =>
      c.json(
        await queries.history(
          actor,
          c.req.param("id"),
          c.req.query("before"),
          c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
        ),
      ),
    )
    .get("/sessions/:id/approvals", async (c) =>
      c.json(await queries.approvals(actor, c.req.param("id"))),
    )
    .get("/sessions/:id/events", async (c) => {
      // Validate before starting SSE so denied or missing sessions have an HTTP error.
      await queries.session(actor, c.req.param("id"));
      return streamSnapshots(c, () =>
        queries.session(actor, c.req.param("id")),
      );
    })
    .get("/inspection/activity", async (c) =>
      c.json(
        await queries.activity(
          actor,
          c.req.query("before"),
          c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
        ),
      ),
    );
}
