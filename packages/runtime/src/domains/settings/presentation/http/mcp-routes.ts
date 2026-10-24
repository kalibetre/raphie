import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotMcp } from "../../infrastructure/bot-mcp.ts";

const name = z.string().trim().min(1).max(80);
const connection = z.discriminatedUnion("transport", [
  z
    .object({
      name,
      transport: z.literal("http"),
      url: z.url().max(2048),
      token: z.string().max(4096).optional(),
    })
    .strict(),
  z
    .object({
      name,
      transport: z.literal("stdio"),
      command: z.string().trim().min(1).max(1024),
      args: z.array(z.string().max(4096)).max(64).optional(),
      env: z
        .record(
          z
            .string()
            .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
            .max(100),
          z.string().max(8192),
        )
        .refine((v) => Object.keys(v).length <= 64)
        .optional(),
    })
    .strict(),
]);

export function mcpRoutes(mcp: BotMcp) {
  return new Hono()
    .get("/", (c) => c.json({ items: mcp.read() }))
    .post("/", limitBody(64_000), jsonInput(connection), async (c) =>
      c.json({ items: await mcp.add(c.req.valid("json")) }, 201),
    )
    .post(
      "/:id",
      limitBody(1024),
      jsonInput(
        z.object({ action: z.enum(["enable", "disable", "remove"]) }).strict(),
      ),
      async (c) =>
        c.json({
          items: await mcp.change(
            c.req.param("id"),
            c.req.valid("json").action,
          ),
        }),
    );
}
