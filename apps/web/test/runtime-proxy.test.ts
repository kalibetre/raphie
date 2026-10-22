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

test("local backend selection is probed, browser-scoped and used by normal requests and event streams", async () => {
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/runtime")
        return Response.json({ model: null, mcp: { connected: false } });
      return Response.json({ path, cookie: request.headers.get("cookie") });
    },
  });
  const request = (url: string, action = "connect") =>
    new Request("http://127.0.0.1:4320/api/web/connection", {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify({ url, action }),
    });
  try {
    for (const invalid of [
      "https://example.com",
      "http://127.0.0.1:4320",
      "http://user:password@localhost:4316",
      "http://127.0.0.1:4316/path",
      "http://127.0.0.1:4316?key=private",
    ])
      assert.equal((await proxyRuntime(request(invalid))).status, 400);
    const address = `http://127.0.0.1:${backend.port}`;
    const tested = await proxyRuntime(request(address, "test"));
    assert.equal(tested.status, 200);
    assert.equal(tested.headers.get("set-cookie"), null);
    const saved = await proxyRuntime(request(address));
    assert.equal(saved.status, 200);
    const cookie = saved.headers.get("set-cookie")!;
    assert.match(cookie, /raphie_backend_4320=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const headers = { cookie: cookie.split(";")[0]! };
    const selected = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/web/connection", { headers }),
    );
    assert.equal((await selected.json()).url, address);
    for (const path of ["/api/sessions", "/api/sessions/events"]) {
      const mismatch = await proxyRuntime(
        new Request(`http://127.0.0.1:4320${path}`, {
          headers: { ...headers, "x-raphie-backend": "http://127.0.0.1:1" },
        }),
      );
      assert.equal(mismatch.status, 409);
      const staleStream = await proxyRuntime(
        new Request(
          `http://127.0.0.1:4320${path}?_raphie_backend=http://127.0.0.1:1`,
          { headers },
        ),
      );
      assert.equal(staleStream.status, 409);

      const response = await proxyRuntime(
        new Request(`http://127.0.0.1:4320${path}`, { headers }),
      );
      assert.deepEqual(await response.json(), { path, cookie: null });
    }
    const staleAction = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/tool-approvals/old", {
        method: "POST",
        headers: { ...headers, "x-raphie-backend": "http://127.0.0.1:1" },
        body: "{}",
      }),
    );
    assert.equal(staleAction.status, 409);
    await backend.stop(true);
    assert.equal((await proxyRuntime(request(address))).status, 503);
  } finally {
    await backend.stop(true);
  }
});
