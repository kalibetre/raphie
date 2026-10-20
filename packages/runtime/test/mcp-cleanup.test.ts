import { test, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { connectMcp } from "../src/infrastructure/mcp/client.ts";
import { rpcResponse } from "./mcp-fixture.ts";

test("failed remote MCP session deletion does not fail local shutdown", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  let deletes = 0;
  const server = createServer((req, res) => {
    if (req.method === "DELETE") {
      deletes++;
      res.writeHead(500);
      res.end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = rpcResponse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      res.writeHead(response ? 200 : 202, {
        "content-type": "application/json",
        "mcp-session-id": "fixture-session",
      });
      res.end(response ? JSON.stringify(response) : undefined);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const connection = await connectMcp({
    transport: "http",
    url: `http://127.0.0.1:${address.port}/mcp`,
  });
  try {
    await assert.doesNotReject(connection.close());
    assert.equal(deletes, 1);
    assert.equal(warning.mock.calls.length, 1);
    assert.deepEqual(warning.mock.calls[0], [
      "MCP remote session cleanup failed; closing the local connection.",
    ]);
  } finally {
    warning.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
