import { test } from "bun:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";

import { connectMcp } from "../src/infrastructure/mcp/client.ts";
import { rpcResponse } from "./mcp-fixture.ts";

for (const mode of ["http"] as const)
  test(`MCP ${mode}: authenticated handshake, paginated discovery, and tool round trip`, async () => {
    const headers: string[] = [];

    async function handleRequest(req: IncomingMessage, res: ServerResponse) {
      headers.push(req.headers.authorization ?? "");
      if (req.headers.authorization !== "Bearer fixture-token") {
        res.writeHead(401);
        res.end("{}");
        return;
      }
      if (req.method === "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = rpcResponse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      res.writeHead(response ? 200 : 202, {
        "content-type": "application/json",
      });
      res.end(response ? JSON.stringify(response) : undefined);
    }

    const server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    let connection;
    try {
      const url = `http://127.0.0.1:${address.port}/mcp`;
      await assert.rejects(connectMcp({ transport: mode, url }));
      connection = await connectMcp({
        transport: mode,
        url,
        token: "fixture-token",
      });
      assert.equal(connection.server?.name, "fixture-mcp");
      assert.deepEqual(
        connection.tools.map((t) => t.name),
        ["echo", "server_info"],
      );
      const result = await connection.call("echo", { text: "MCP works" });
      assert.deepEqual(result.content, [{ type: "text", text: "MCP works" }]);
      await assert.rejects(
        connection.call("unadvertised", {}),
        /not advertised/,
      );
      assert.equal(
        headers.filter((h) => h === "Bearer fixture-token").length >= 4,
        true,
      );
    } finally {
      await connection?.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  });

test("MCP stdio: same discovery and tool interface with a local server process", async () => {
  const connection = await connectMcp({
    transport: "stdio",
    command: process.execPath,
    args: [new URL("./mcp-stdio.ts", import.meta.url).pathname],
  });
  try {
    assert.equal(connection.tools.length, 2);
    const result = await connection.call("echo", { text: "Local MCP works" });
    assert.deepEqual(result.content, [
      { type: "text", text: "Local MCP works" },
    ]);
  } finally {
    await connection.close();
  }
});
