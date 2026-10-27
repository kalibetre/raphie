import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";
import { OwnerStore } from "../src/infrastructure/auth/owner-store.ts";
import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";

test("Bun web host serves assets, delegates SSR, and rejects hidden files and foreign hosts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-web-host-"));
  await writeFile(join(directory, "asset.js"), "console.log('fixture')");
  await writeFile(join(directory, ".private"), "hidden fixture");
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    build: { id: "fixture-revision", version: "v1.2.3" },
    fetch: (request) => new Response(`SSR ${new URL(request.url).pathname}`),
  });
  try {
    const version = await fetch(new URL("/_raphie/version", server.url));
    assert.deepEqual(await version.json(), {
      id: "fixture-revision",
      version: "v1.2.3",
    });
    assert.equal(version.headers.get("cache-control"), "no-store");
    const asset = await fetch(new URL("/asset.js", server.url));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.equal(await asset.text(), "console.log('fixture')");
    assert.equal(
      await (await fetch(new URL("/sessions/fixture", server.url))).text(),
      "SSR /sessions/fixture",
    );
    assert.equal((await fetch(new URL("/.private", server.url))).status, 404);
    assert.equal((await fetch(new URL("/%2eprivate", server.url))).status, 404);
    assert.equal((await fetch(new URL("/%zz", server.url))).status, 400);
    const rejected = await new Promise<number | undefined>(
      (resolve, reject) => {
        get(
          new URL("/", server.url),
          { headers: { Host: "evil.example" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(rejected, 403);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("experimental paired browsers and native devices are authorized without weakening origin checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-paired-web-"));
  const authDatabase = join(directory, "auth.sqlite");
  const pairingDatabase = join(directory, "pairing.sqlite");
  const owner = new OwnerStore(authDatabase);
  await owner.setOwner("owner", "synthetic password one");
  owner.close();
  const pairing = new PairingStore(pairingDatabase);
  const browserCode = pairing.createCode();
  const nativeCode = pairing.createCode();
  const origin = "http://localhost:4320";
  assert.throws(
    () =>
      startWebServer({
        clientDirectory: directory,
        port: 0,
        remote: {
          origin,
          hostname: "0.0.0.0",
          authDatabase,
          experimentalPairingDatabase: pairingDatabase,
        },
        fetch: () => new Response("protected"),
      }),
    /must bind to a loopback address/,
  );
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    remote: {
      origin,
      hostname: "127.0.0.1",
      authDatabase,
      experimentalPairingDatabase: pairingDatabase,
    },
    fetch: (request) =>
      new URL(request.url).pathname === "/api/events"
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(": ready\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          )
        : new Response("protected"),
  });
  const request = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("host", "localhost:4320");
    return fetch(new URL(path, server.url), {
      ...init,
      headers,
      redirect: "manual",
    });
  };
  const redeem = (path: string, secret: string, browser: boolean) =>
    request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(browser ? { origin } : {}),
      },
      body: JSON.stringify({ secret, label: browser ? "Browser" : "Phone" }),
    });
  try {
    const browser = await redeem(
      "/auth/pairing/redeem",
      browserCode.secret,
      true,
    );
    assert.equal(browser.status, 200);
    const cookie = browser.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      (await request("/api/sessions", { headers: { cookie } })).status,
      200,
    );
    assert.equal(
      (
        await request("/api/sessions", {
          method: "POST",
          headers: { cookie, origin: "http://evil.test" },
        })
      ).status,
      403,
    );
    const native = await redeem(
      "/auth/pairing/redeem-native",
      nativeCode.secret,
      false,
    );
    const data = (await native.json()) as { id: string; credential: string };
    const authorization = `Bearer ${data.credential}`;
    assert.equal(
      (
        await request("/api/sessions", {
          method: "POST",
          headers: { authorization },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/sessions", {
          method: "POST",
          headers: { authorization, origin: "http://evil.test" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/auth/pairing/devices", { headers: { authorization } }))
        .status,
      401,
    );
    const stream = await request("/api/events", { headers: { authorization } });
    const reader = stream.body!.getReader();
    assert.equal((await reader.read()).done, false);
    const next = reader.read();
    pairing.revoke(data.id);
    assert.equal((await next).done, true);
    assert.equal(
      (await request("/api/sessions", { headers: { authorization } })).status,
      401,
    );
    const logout = await request("/auth/logout", {
      method: "POST",
      headers: { cookie, origin },
    });
    assert.equal(logout.status, 303);
    assert.equal(
      (await request("/api/sessions", { headers: { cookie } })).status,
      401,
    );
  } finally {
    pairing.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote web host requires an owner before it serves pages or assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-remote-web-"));
  const authDatabase = join(directory, "auth.sqlite");
  assert.throws(
    () =>
      startWebServer({
        clientDirectory: directory,
        port: 0,
        remote: {
          origin: "http://localhost:4320",
          hostname: "127.0.0.1",
          authDatabase,
        },
        fetch: () => new Response("private app"),
      }),
    /not configured/,
  );
  const store = new OwnerStore(authDatabase);
  await store.setOwner("owner", "synthetic password one");
  store.close();
  const origin = "http://localhost:4320";
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    remote: { origin, hostname: "127.0.0.1", authDatabase },
    fetch: () => new Response("private app"),
  });
  const request = async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("host", "localhost:4320");
    return fetch(new URL(path, server.url), {
      ...init,
      headers,
      redirect: "manual",
    });
  };
  try {
    assert.equal((await request("/api/sessions")).status, 401);
    assert.equal((await request("/")).status, 303);
    const login = await request("/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "owner",
        password: "synthetic password one",
      }),
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      await (await request("/", { headers: { cookie } })).text(),
      "private app",
    );
    assert.equal(
      (
        await request("/api/sessions", {
          headers: { cookie, origin: "http://evil.test" },
        })
      ).status,
      403,
    );
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
