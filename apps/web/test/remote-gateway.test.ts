import { test } from "bun:test";
import assert from "node:assert/strict";

import { pairedAuth } from "../src/infrastructure/auth/paired-auth.ts";
import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";
import { remoteAddress } from "../src/infrastructure/http/remote-session.server.ts";
import { proxyRuntime } from "../src/infrastructure/http/runtime-proxy.server.ts";

test("remote gateway pairing proxies requests without exposing its device credential", async () => {
  const store = new PairingStore(":memory:");
  let auth: ReturnType<typeof pairedAuth>;
  const remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const denied = await auth(request);
      if (denied) return denied;
      return Response.json(
        {
          model: null,
          mcp: { connected: false },
          origin: request.headers.get("origin"),
        },
        { headers: { "set-cookie": "attacker=not-forwarded" } },
      );
    },
  });
  const url = `http://127.0.0.1:${remote.port}`;
  auth = pairedAuth(store, url);
  const connect = (action: "test" | "connect", pairing: string) =>
    proxyRuntime(
      new Request("http://127.0.0.1:4320/api/web/connection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-raphie-client": "web",
          origin: "http://127.0.0.1:4320",
        },
        body: JSON.stringify({
          action,
          url,
          kind: "remote",
          ...(action === "test"
            ? { pairingLink: pairing }
            : { pairingHandle: pairing }),
        }),
      }),
    );
  try {
    assert.throws(() => remoteAddress("http://public.example"));
    assert.throws(() => remoteAddress("https://user:pass@example.test"));
    assert.equal((await connect("test", "invalid link")).status, 400);
    const secret = store.createCode().secret;
    const tested = await connect(
      "test",
      `${url}/auth/pairing/page#token=${secret}`,
    );
    assert.equal(tested.status, 200);
    assert.equal(tested.headers.get("set-cookie"), null);
    const handle = (await tested.json()).pairingHandle as string;
    const selected = await connect("connect", handle);
    assert.equal(selected.status, 200);
    const cookies = selected.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    assert.doesNotMatch(cookies, /raphie_device=/);
    const response = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/runtime", {
        headers: {
          cookie: cookies,
          origin: "http://127.0.0.1:4320",
          "x-raphie-backend": url,
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).origin, null);
    const missingHandle = cookies
      .split("; ")
      .filter((cookie) => !cookie.startsWith("raphie_remote_"))
      .join("; ");
    const expired = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/runtime", {
        headers: { cookie: missingHandle, "x-raphie-backend": url },
      }),
    );
    assert.equal(expired.status, 401);
    const stale = await proxyRuntime(
      new Request("http://127.0.0.1:4320/api/runtime", {
        headers: { cookie: cookies, "x-raphie-backend": "http://127.0.0.1:1" },
      }),
    );
    assert.equal(stale.status, 409);
  } finally {
    await remote.stop(true);
    store.close();
  }
});
