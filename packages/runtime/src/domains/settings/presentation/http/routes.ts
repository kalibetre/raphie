import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { SettingsService } from "../../application/ports.ts";

const key = z.string().min(1).max(4096).regex(/^\S+$/);
const name = z.string().trim().min(1).max(80);

export function settingsRoutes(settings: SettingsService) {
  return new Hono()
    .get("/", async (c) => c.json(await settings.read()))
    .post(
      "/",
      limitBody(8192),
      jsonInput(
        z
          .object({
            telemetryEnabled: z.boolean().optional(),
            provider: z.string().max(80).optional(),
            providerEnabled: z.boolean().optional(),
            modelId: z.string().max(256).optional(),
            connectionId: z.string().max(80).optional(),
            apiKey: key.nullable().optional(),
          })
          .strict(),
      ),
      async (c) => c.json(await settings.update(c.req.valid("json"))),
    )
    .post(
      "/connections",
      limitBody(8192),
      jsonInput(
        z.object({ provider: z.string().max(80), name, apiKey: key }).strict(),
      ),
      async (c) => c.json(await settings.addConnection(c.req.valid("json"))),
    )
    .post(
      "/connections/:id",
      limitBody(8192),
      jsonInput(z.object({ name, apiKey: key.optional() }).strict()),
      async (c) =>
        c.json(
          await settings.editConnection(c.req.param("id"), c.req.valid("json")),
        ),
    )
    .post(
      "/connections/:id/remove",
      limitBody(8192),
      jsonInput(z.object({}).strict()),
      async (c) => c.json(await settings.removeConnection(c.req.param("id"))),
    )
    .post(
      "/connections/:id/test",
      limitBody(8192),
      jsonInput(z.object({ apiKey: key.optional() }).strict()),
      async (c) => {
        await settings.testConnection(
          c.req.param("id"),
          c.req.valid("json").apiKey,
        );
        return c.json({ connected: true });
      },
    )
    .post(
      "/provider/test",
      limitBody(8192),
      jsonInput(z.object({ apiKey: key.optional() }).strict()),
      async (c) => {
        await settings.testProvider(c.req.valid("json").apiKey);
        return c.json({ connected: true });
      },
    );
}
