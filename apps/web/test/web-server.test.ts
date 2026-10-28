import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";
import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";

test("pairing-only server starts without an owner account and protects the runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-pair-only-"));
  const oldAccount = join(directory, "auth.sqlite");
  await writeFile(oldAccount, "previous account data");
  const database = join(directory, "pairing.sqlite");
  const origin = "http://localhost:4320";
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    remote: {
      origin,
      hostname: "127.0.0.1",
      pairingDatabase: database,
    },
    fetch: () => new Response("protected"),
  });
  const store = new PairingStore(database);
  try {
    const req = (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("host", "localhost:4320");
      return fetch(new URL(path, server.url), {
        ...init,
        headers,
        redirect: "manual",
      });
    };
    assert.equal((await req("/")).headers.get("location"), "/auth/connect");
    const secret = store.createCode().secret;
    const response = await req("/auth/pairing/redeem", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ secret, label: "Browser" }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      await (await req("/api/runtime", { headers: { cookie } })).text(),
      "protected",
    );
    assert.equal(await readFile(oldAccount, "utf8"), "previous account data");
  } finally {
    store.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

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
  const pairingDatabase = join(directory, "pairing.sqlite");
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
          pairingDatabase,
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
      pairingDatabase,
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
