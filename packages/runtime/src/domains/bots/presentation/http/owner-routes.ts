import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import type { BotProfiles } from "../../application/ports.ts";
import { MAX_INSTRUCTIONS_LENGTH } from "../../domain/instructions.ts";
import { knownTimeZone } from "../../domain/owner.ts";

const owner = z
  .object({
    name: z.string().trim().max(80),
    callMe: z.string().trim().max(40),
    timeZone: z
      .string()
      .trim()
      .refine((zone) => zone === "" || knownTimeZone(zone), {
        message: "Choose a time zone such as Africa/Addis_Ababa.",
      }),
    about: z.string().trim().max(2000),
    // null goes back to Raphie's own.
    instructions: z
      .string()
      .trim()
      .max(MAX_INSTRUCTIONS_LENGTH)
      .nullable()
      .optional(),
  })
  .strict();

/** The owner's profile, shared by every bot; owner-only, not a model tool. */
export function ownerRoutes(bots: BotProfiles) {
  return new Hono()
    .get("/", (c) => c.json(bots.owner()))
    .put("/", limitBody(100_000), jsonInput(owner), (c) =>
      c.json(bots.saveOwner(c.req.valid("json"))),
    );
}
