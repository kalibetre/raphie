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
