import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { ChannelHome } from "../../application/home.ts";

export function homeRoutes(home: ChannelHome) {
  return new Hono()
    .get("/", async (c) => c.json(await home.read()))
    .post(
      "/",
      limitBody(2048),
      jsonInput(z.object({ id: z.string().max(1024).nullable() }).strict()),
      async (c) => c.json(await home.select(c.req.valid("json").id)),
    );
}
