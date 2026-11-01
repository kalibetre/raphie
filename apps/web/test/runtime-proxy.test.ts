import { test } from "bun:test";
import assert from "node:assert/strict";

import { proxyRuntime } from "../src/infrastructure/http/runtime-proxy.server.ts";

test("production API proxy refuses foreign hosts and origins before reaching the runtime", async () => {
  assert.equal(
    (await proxyRuntime(new Request("http://untrusted.example:4320/api/chats")))
      .status,
    403,
  );
  assert.equal(
    (
      await proxyRuntime(
        new Request("http://127.0.0.1:4320/api/chat", {
          method: "POST",
          headers: { Origin: "https://untrusted.example" },
        }),
      )
    ).status,
    403,
  );
});

test("the configured runtime is used regardless of an old selection cookie", async () => {
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ ok: true }),
  });
  const previous = process.env.RAPHIE_RUNTIME_URL;
  process.env.RAPHIE_RUNTIME_URL = `http://127.0.0.1:${backend.port}`;
  try {
    const headers = {
      cookie: "raphie_backend_4320=http%3A%2F%2F127.0.0.1%3A1",
    };
    const response = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/runtime", { headers }),
    );
    assert.deepEqual(await response.json(), { ok: true });
    const selection = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/web/connection", {
        method: "POST",
      }),
    );
    assert.equal(selection.status, 405);
  } finally {
    if (previous === undefined) delete process.env.RAPHIE_RUNTIME_URL;
    else process.env.RAPHIE_RUNTIME_URL = previous;
    await backend.stop(true);
  }
});

test("HTTPS configuration accepts its host and local HTTP without accepting cross-origin requests", async () => {
  const previous = process.env.RAPHIE_WEB_ORIGIN;
  process.env.RAPHIE_WEB_ORIGIN = "https://raphie.example.test";
  const previousAdditional = process.env.RAPHIE_WEB_ALLOWED_ORIGINS;
  process.env.RAPHIE_WEB_ALLOWED_ORIGINS = "https://second.example.test:8443";
  try {
    for (const host of [
      "https://raphie.example.test",
      "https://second.example.test:8443",
      "http://127.0.0.1:4320",
      "http://localhost:4320",
    ]) {
      const response = await proxyRuntime(
        new Request(`${host}/api/web/connection`, {
          headers: { origin: host },
        }),
      );
      assert.equal(response.status, 200);
    }
    const rejected = await proxyRuntime(
      new Request("http://localhost:4320/api/web/connection", {
        headers: { origin: "https://raphie.example.test" },
      }),
    );
    assert.equal(rejected.status, 403);
  } finally {
    if (previousAdditional === undefined)
      delete process.env.RAPHIE_WEB_ALLOWED_ORIGINS;
    else process.env.RAPHIE_WEB_ALLOWED_ORIGINS = previousAdditional;
    if (previous === undefined) delete process.env.RAPHIE_WEB_ORIGIN;
    else process.env.RAPHIE_WEB_ORIGIN = previous;
  }
});
