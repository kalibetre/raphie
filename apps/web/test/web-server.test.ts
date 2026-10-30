import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";

// Authentication is covered by auth-gateway.test.ts; this host test admits everything.
const open = {
  check: async () => ({ cookies: [], stillValid: null }),
  finish: (response: Response) => response,
};

test("Bun web host serves assets, delegates SSR, and rejects hidden files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-web-host-"));
  await writeFile(join(directory, "asset.js"), "console.log('fixture')");
  await writeFile(join(directory, ".private"), "hidden fixture");
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    gateway: open,
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
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
