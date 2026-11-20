import { Hono } from "hono";
import { z } from "zod";

import type {
  ActorAuthority,
  ActorContext,
} from "../../../../application/access/actors.ts";
import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import type { AskCommands } from "../../application/ports.ts";
import { MAX_ANSWER_LENGTH } from "../../domain/ask.ts";

const answer = z.union([
  z.object({ choice: z.number().int().min(0).max(5) }),
  z.object({ text: z.string().min(1).max(MAX_ANSWER_LENGTH) }),
]);
const idPattern = /^[a-f0-9-]{36}$/;

/** `POST /asks/:id`: the owner's answer to a bot's question. */
export function askRoutes(
  asks: AskCommands,
  actors: ActorAuthority,
  actor: ActorContext,
) {
  const routes = new Hono();
  routes.post("/asks/:id", limitBody(4096), jsonInput(answer), async (c) => {
    if (!idPattern.test(c.req.param("id")))
      throw new InputError("Not found.", 404);
    const verified = actors.require(actor);
    return c.json({
      status: await asks.answer(
        c.req.param("id"),
        c.req.valid("json"),
        verified.subject,
        verified.source,
        // Set by the web host from the device's sign-in, never by a client.
        c.req.header("x-raphie-app") === "desktop" ? "desktop" : undefined,
      ),
    });
  });
  return routes;
}
