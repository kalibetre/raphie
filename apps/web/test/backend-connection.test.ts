import { expect, test } from "bun:test";

import { backendAddress } from "../src/infrastructure/http/backend-connection.server";

test("an obsolete remote backend cookie falls back to the local runtime", () => {
  const request = new Request("http://127.0.0.1:4320/api/web/connection", {
    headers: { cookie: "raphie_backend_4320=https%3A%2F%2Fexample.com" },
  });

  expect(backendAddress(request)).toBe(
    process.env.RAPHIE_RUNTIME_URL ?? "http://127.0.0.1:4316",
  );
});
