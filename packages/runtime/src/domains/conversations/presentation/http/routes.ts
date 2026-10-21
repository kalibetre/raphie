import { Hono } from "hono";
import { z } from "zod";

import type { ActorContext } from "../../../../application/access/actors.ts";
import type { Sessions } from "../../../../application/sessions/operations.ts";
import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";

const model = z
  .object({
    provider: z.string().min(1).max(80),
    modelId: z.string().min(1).max(256),
  })
  .strict();

const message = z.object({
  text: z.string().min(1).max(4000),
  eventId: z.string().min(1).max(200),
  conversationId: z.number().int().positive().optional(),
});

export function conversationRoutes(
  conversations: Pick<Sessions, "submit" | "submitLegacy" | "chooseModel">,
  actor: ActorContext,
) {
  return new Hono()
    .post(
      "/sessions/:id/model",
      limitBody(1024),
      jsonInput(model),
      async (c) => {
        await conversations.chooseModel(
          actor,
          c.req.param("id"),
          c.req.valid("json"),
        );
        return c.json({ model: c.req.valid("json") });
      },
    )
    .post(
      "/sessions/messages",
      limitBody(20_000),
      jsonInput(
        message
          .omit({ conversationId: true })
          .extend({ sessionId: z.uuid().optional(), model: model.optional() }),
      ),
      async (c) =>
        c.json(await conversations.submit(actor, c.req.valid("json")), 201),
    )
    .post("/chat", limitBody(20_000), jsonInput(message), async (c) => {
      const sent = await conversations.submitLegacy(actor, c.req.valid("json"));
      return c.json(sent, 201);
    });
}
