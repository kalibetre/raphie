import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import type { ZodType } from "zod";

export const limitBody = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: "Request is too large." }, 413),
  });

export const jsonInput = <T>(schema: ZodType<T>) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        400,
      );
    return parsed.data;
  });
