import { test } from "bun:test";
import assert from "node:assert/strict";

import { pairedAuth } from "../src/infrastructure/auth/paired-auth.ts";
import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";

test("pairing-only authentication permits devices and removes access on sign out", async () => {
  const store = new PairingStore(":memory:");
  try {
    const origin = "https://raphie.example";
    const auth = pairedAuth(store, origin);
    const request = (path: string, init?: RequestInit) =>
      new Request(origin + path, init);
    assert.equal(
      (await auth(request("/")))?.headers.get("location"),
      "/auth/connect",
    );
    const page = await auth(request("/auth/connect"));
    assert.match(await page!.text(), /sudo raphie pair/);
    assert.equal((await auth(request("/api/runtime")))?.status, 401);
    const code = store.createCode();
    const redeem = await auth(
      request("/auth/pairing/redeem", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ secret: code.secret, label: "Browser" }),
      }),
    );
    assert.equal(redeem?.status, 200);
    const cookie = redeem!.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      await auth(request("/api/runtime", { headers: { cookie } })),
      null,
    );
    assert.equal(
      (
        await auth(
          request("/auth/logout", { method: "POST", headers: { cookie } }),
        )
      )?.status,
      403,
    );
    assert.equal(
      (
        await auth(
          request("/auth/logout", {
            method: "POST",
            headers: { cookie, origin },
          }),
        )
      )?.status,
      303,
    );
    assert.equal(
      (await auth(request("/api/runtime", { headers: { cookie } })))?.status,
      401,
    );
    assert.equal(
      (await auth(request("/auth/login")))?.headers.get("location"),
      "/auth/connect",
    );
  } finally {
    store.close();
  }
});
