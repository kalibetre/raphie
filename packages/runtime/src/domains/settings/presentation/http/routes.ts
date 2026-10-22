import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { SettingsService } from "../../application/ports.ts";

const key = z.string().min(1).max(4096).regex(/^\S+$/);

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
            apiKey: key.nullable().optional(),
          })
          .strict(),
      ),
      async (c) => c.json(await settings.update(c.req.valid("json"))),
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
