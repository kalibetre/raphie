import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** A loopback port that is free now. */
function freePort() {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const { port } = listener;
  listener.stop(true);
  return port;
}

test("the runtime finishes its shutdown when a second signal follows the first, and logs how long it took", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-shutdown-"));
  const key = join(temp, "key", "master-key");
  await mkdir(join(temp, "key"), { mode: 0o700 });
  await writeFile(key, `${randomBytes(32).toString("base64")}\n`);
  await chmod(key, 0o600);
  // An MCP server that is slow to close its session, so the runtime's
  // shutdown takes a moment, as it can over a slow network.
  const mcp = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE") {
        await Bun.sleep(5000);
        return new Response(null);
      }
      if (request.method === "GET") return new Response(null, { status: 405 });
      const message = (await request.json()) as {
        id?: number;
        method: string;
        params?: { protocolVersion?: string };
      };
      const headers = { "mcp-session-id": "fixture-session" };
      if (message.id === undefined)
        return new Response(null, { status: 202, headers });
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : { tools: [] };
      return Response.json(
        { jsonrpc: "2.0", id: message.id, result },
        { headers },
      );
    },
  });
  const port = freePort();
  const runtime = Bun.spawn(
    [process.execPath, resolve("packages/runtime/src/main.ts")],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATA_DIRECTORY: join(temp, "data"),
        RAPHIE_CREDENTIAL_KEY_FILE: key,
        PORT: String(port),
        RAPHIE_WEB_ORIGIN: `http://127.0.0.1:${freePort()}`,
        MCP_URL: `http://127.0.0.1:${mcp.port}/mcp`,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    let up = false;
    for (let attempt = 0; attempt < 100 && !up; attempt++) {
      // Any answer means it is listening.
      up = await fetch(`http://127.0.0.1:${port}/api/runtime`)
        .then(() => true)
        .catch(() => false);
      if (!up) await Bun.sleep(100);
    }
    assert.ok(up, "the runtime started");
    // `raphie start` used to pass on a stop twice, and Ctrl-C reaches the
    // whole process group: the second signal killed the runtime mid-stop.
    runtime.kill("SIGTERM");
    // The second arrives while the first is being handled, as it did when
    // the web host had exited.
    await Bun.sleep(200);
    runtime.kill("SIGTERM");
    assert.equal(await runtime.exited, 0, "it stopped cleanly, not killed");
    const log = await new Response(runtime.stdout).text();
    assert.match(
      log,
      /^\d{4}-\d\d-\d\dT[\d:.]+Z Raphie runtime stopping \(SIGTERM\)$/m,
    );
    assert.match(log, /Z Raphie runtime stopped after \d+\.\ds$/m);
    // The slow step is named.
    assert.match(log, /Z Raphie runtime: closing bots took \d+\.\ds$/m);
  } finally {
    runtime.kill("SIGKILL");
    await mcp.stop(true);
    await rm(temp, { recursive: true, force: true });
  }
}, 30_000);
