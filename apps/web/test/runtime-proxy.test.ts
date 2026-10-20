import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyRuntime } from "../src/lib/runtime-proxy.server.ts";

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
