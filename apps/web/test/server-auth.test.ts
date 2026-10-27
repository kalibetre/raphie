import { test } from "bun:test";
import assert from "node:assert/strict";

import { OwnerStore } from "../src/infrastructure/auth/owner-store.ts";
import {
  guardEventStream,
  serverAuth,
} from "../src/infrastructure/auth/server-auth.ts";

test("server authentication protects pages and API, validates origin and revokes sessions", async () => {
  const store = new OwnerStore(":memory:");
  try {
    assert.throws(() => serverAuth(store, "http://server.test:4320"));
    await store.setOwner("owner", "synthetic password one");
    const check = serverAuth(store, "http://server.test:4320");
    const req = (path: string, init?: RequestInit) =>
      new Request(`http://server.test:4320${path}`, init);
    assert.equal((await check(req("/")))?.status, 303);
    assert.equal((await check(req("/api/sessions")))?.status, 401);
    assert.equal((await check(req("/auth/login")))?.status, 200);
    const body = new URLSearchParams({
      username: "owner",
      password: "synthetic password one",
    });
    assert.equal(
      (await check(req("/auth/login", { method: "POST", body })))?.status,
      403,
    );
    const login = await check(
      req("/auth/login", {
        method: "POST",
        headers: { origin: "http://server.test:4320" },
        body,
      }),
    );
    assert.equal(login?.status, 303);
    const cookie = login!.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      await check(req("/api/sessions", { headers: { cookie } })),
      null,
    );
    assert.equal(
      (
        await check(
          req("/api/sessions", {
            headers: { cookie, origin: "http://attacker.test" },
          }),
        )
      )?.status,
      403,
    );
    assert.equal(
      (
        await check(
          new Request("http://attacker.test/api/sessions", {
            headers: { cookie },
          }),
        )
      )?.status,
      403,
    );
    const logout = await check(
      req("/auth/logout", {
        method: "POST",
        headers: { cookie, origin: "http://server.test:4320" },
      }),
    );
    assert.equal(logout?.status, 303);
    assert.equal(
      (await check(req("/api/sessions", { headers: { cookie } })))?.status,
      401,
    );
  } finally {
    store.close();
  }
});

test("revoking a session closes even an idle event stream", async () => {
  const store = new OwnerStore(":memory:");
  try {
    await store.setOwner("owner", "synthetic password one");
    const token = (await store.signIn("owner", "synthetic password one"))!;
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const guarded = guardEventStream(
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      }),
      store,
      token,
      5,
    );
    const pending = guarded.body!.getReader().read();
    store.signOut(token);
    assert.equal((await pending).done, true);
    assert.equal(cancelled, true);
  } finally {
    store.close();
  }
});

test("changing owner credentials requires the current password and revokes existing sessions", async () => {
  const store = new OwnerStore(":memory:");
  try {
    await store.setOwner("owner", "synthetic password one");
    const token = (await store.signIn("owner", "synthetic password one"))!;
    const check = serverAuth(store, "http://server.test:4320");
    const origin = "http://server.test:4320";
    const change = (current: string) =>
      check(
        new Request(`${origin}/auth/account`, {
          method: "POST",
          headers: { origin, cookie: `raphie_session=${token}` },
          body: new URLSearchParams({
            username: "new-owner",
            password: current,
            newPassword: "synthetic password two",
            confirmPassword: "synthetic password two",
          }),
        }),
      );
    assert.equal((await change("incorrect"))?.status, 400);
    assert.equal(store.valid(token), true);
    assert.equal((await change("synthetic password one"))?.status, 303);
    assert.equal(store.valid(token), false);
    assert.equal(await store.signIn("owner", "synthetic password one"), null);
    assert.ok(await store.signIn("new-owner", "synthetic password two"));
  } finally {
    store.close();
  }
});
