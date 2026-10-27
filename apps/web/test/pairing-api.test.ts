import { test } from "bun:test";
import assert from "node:assert/strict";

import { pairingApi } from "../src/infrastructure/auth/pairing-api.ts";
import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";
import { guardEventStream } from "../src/infrastructure/auth/server-auth.ts";

test("pairing protocol limits enrollment, separates browser cookies and native credentials, and revokes devices", async () => {
  const store = new PairingStore(":memory:");
  try {
    assert.throws(() => pairingApi(store, "http://public.example"));
    const origin = "https://raphie.example";
    const handle = pairingApi(store, origin);
    const post = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await handle(post("/auth/pairing/create", {}, { origin }), false))
        ?.status,
      401,
    );
    assert.equal(
      (
        await handle(
          post("/auth/pairing/create", {}, { origin: "https://evil.example" }),
          true,
        )
      )?.status,
      403,
    );
    const created = await handle(
      post("/auth/pairing/create", {}, { origin }),
      true,
    );
    assert.equal(created?.headers.get("cache-control"), "no-store");
    const code = (await created!.json()) as { secret: string };
    const response = await handle(
      post(
        "/auth/pairing/redeem",
        { secret: code.secret, label: "Browser" },
        { origin },
      ),
      false,
    );
    assert.equal(response?.status, 200);
    const cookie = response!.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/; Secure/);
    assert.equal("credential" in (await response!.json()), false);
    assert.equal(
      (
        await handle(
          post(
            "/auth/pairing/redeem",
            { secret: code.secret, label: "Replay" },
            { origin },
          ),
          false,
        )
      )?.status,
      400,
    );
    const nativeCode = store.createCode();
    assert.equal(
      (
        await handle(
          post(
            "/auth/pairing/redeem-native",
            { secret: nativeCode.secret, label: "Phone" },
            { origin },
          ),
          false,
        )
      )?.status,
      403,
    );
    const native = await handle(
      post("/auth/pairing/redeem-native", {
        secret: nativeCode.secret,
        label: "Phone",
      }),
      false,
    );
    const device = (await native!.json()) as { id: string; credential: string };
    assert.equal(store.valid(device.credential), true);
    const logoutHeaders = { authorization: `Bearer ${device.credential}` };
    assert.equal(
      (
        await handle(
          post("/auth/pairing/revoke-self", {}, { ...logoutHeaders, origin }),
          false,
        )
      )?.status,
      403,
    );
    assert.equal(
      (
        await handle(
          post("/auth/pairing/revoke-self", {}, logoutHeaders),
          false,
        )
      )?.status,
      200,
    );
    assert.equal(store.valid(device.credential), false);
    assert.equal(
      (
        await handle(
          post(
            "/auth/pairing/redeem",
            { secret: "x".repeat(5000), label: "Big" },
            { origin },
          ),
          false,
        )
      )?.status,
      400,
    );
  } finally {
    store.close();
  }
});

test("revoking a paired device closes its idle live stream", async () => {
  const store = new PairingStore(":memory:");
  try {
    const device = store.redeem(store.createCode().secret, "Phone")!;
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = guardEventStream(
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      }),
      { valid: (token) => store.isValid(token) },
      device.credential,
      10,
    );
    const reader = response.body!.getReader();
    const read = reader.read();
    store.revoke(device.id);
    assert.equal((await read).done, true);
    assert.equal(cancelled, true);
  } finally {
    store.close();
  }
});

test("pairing redemption rate limits failures and rejects foreign hosts and non-JSON input", async () => {
  const store = new PairingStore(":memory:");
  try {
    const origin = "https://raphie.example";
    const handle = pairingApi(store, origin);
    const request = (url: string, contentType = "application/json") =>
      new Request(url, {
        method: "POST",
        headers: { origin, "content-type": contentType },
        body: JSON.stringify({ secret: "bad", label: "Phone" }),
      });
    assert.equal(
      (await handle(request("https://evil.example/auth/pairing/redeem"), false))
        ?.status,
      403,
    );
    assert.equal(
      (
        await handle(
          request(`${origin}/auth/pairing/redeem`, "text/plain"),
          false,
        )
      )?.status,
      415,
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await handle(request(`${origin}/auth/pairing/redeem`), false))?.status,
        400,
      );
    assert.equal(
      (await handle(request(`${origin}/auth/pairing/redeem`), false))?.status,
      429,
    );
  } finally {
    store.close();
  }
});
