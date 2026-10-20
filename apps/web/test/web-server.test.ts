import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";

test("Bun web host serves assets, delegates SSR, and rejects hidden files and foreign hosts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-web-host-"));
  await writeFile(join(directory, "asset.js"), "console.log('fixture')");
  await writeFile(join(directory, ".private"), "hidden fixture");
  const server = startWebServer({
    clientDirectory: directory,
    port: 0,
    fetch: (request) => new Response(`SSR ${new URL(request.url).pathname}`),
  });
  try {
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
