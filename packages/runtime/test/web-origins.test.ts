import { expect, test } from "bun:test";

import { Hono } from "hono";

import { webOrigins } from "../../../shared/web-origins.ts";
import {
  browserCors,
  localAccess,
} from "../src/infrastructure/http/local-origin.ts";
import { InputError } from "../src/shared/application/input-error.ts";

test("runtime accepts configured origins and rejects unrelated origins", async () => {
  const origins = webOrigins(
    "http://127.0.0.1:4320",
    4320,
    "https://one.example,https://two.example:8443",
  );
  const app = new Hono();
  app.onError((error, c) =>
    c.text("rejected", error instanceof InputError ? 403 : 500),
  );
  app.use(
    "*",
    localAccess(() => 4316, origins),
    browserCors(origins),
  );
  app.post("/", (c) => c.text("ok"));
  for (const origin of origins) {
    const response = await app.request("http://127.0.0.1:4316/", {
      method: "POST",
      headers: { host: "127.0.0.1:4316", origin, "x-raphie-client": "web" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  }
  const rejected = await app.request("http://127.0.0.1:4316/", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4316",
      origin: "https://evil.example",
      "x-raphie-client": "web",
    },
  });
  expect(rejected.status).toBe(403);
});
