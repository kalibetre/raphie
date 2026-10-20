import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { ConversationCommands } from "../../application/ports.ts";

const message = z.object({
  text: z.string().min(1).max(4000),
  eventId: z.string().min(1).max(200),
  conversationId: z.number().int().positive().optional(),
});

export function conversationRoutes(conversations: ConversationCommands) {
  return new Hono().post(
    "/chat",
    limitBody(20_000),
    jsonInput(message),
    async (c) => {
      const sent = await conversations.send({
        ...c.req.valid("json"),
        source: "web",
        actor: "owner",
      });
      return c.json(sent, 201);
    },
  );
}
