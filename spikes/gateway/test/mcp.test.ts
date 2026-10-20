import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { connectMcp } from '../src/mcp.ts';
import { rpcResponse } from './mcp-fixture.ts';

for (const mode of ['http', 'sse'] as const) test(`MCP ${mode}: authenticated handshake, paginated discovery, and tool round trip`, async () => {
  let sse: ServerResponse | undefined;
  const headers: string[] = [];
  const server = createServer(async (req, res) => {
    headers.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== 'Bearer fixture-token') { res.writeHead(401); res.end('{}'); return; }
    if (req.method === 'GET' && mode === 'sse') {
      sse = res; res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: endpoint\ndata: /messages\n\n'); return;
    }
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = rpcResponse(JSON.parse(Buffer.concat(chunks).toString()));
    if (mode === 'sse') {
      res.writeHead(202); res.end();
      if (response) sse!.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    } else {
      res.writeHead(response ? 200 : 202, { 'content-type': 'application/json' });
      res.end(response ? JSON.stringify(response) : undefined);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  let connection;
  try {
    const url = `http://127.0.0.1:${address.port}/mcp`;
    await assert.rejects(connectMcp({ transport: mode, url }));
    connection = await connectMcp({ transport: mode, url, token: 'fixture-token' });
    assert.equal(connection.server?.name, 'fixture-mcp');
    assert.deepEqual(connection.tools.map(t => t.name), ['echo', 'server_info']);
    const result = await connection.call('echo', { text: 'MCP works' });
    assert.deepEqual(result.content, [{ type: 'text', text: 'MCP works' }]);
    await assert.rejects(connection.call('unadvertised', {}), /not advertised/);
    assert.equal(headers.filter(h => h === 'Bearer fixture-token').length >= 4, true);
  } finally {
    await connection?.close(); sse?.end();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
});

test('MCP stdio: same discovery and tool interface with a local server process', async () => {
  const connection = await connectMcp({ transport: 'stdio', command: process.execPath,
    args: [new URL('./mcp-stdio.ts', import.meta.url).pathname] });
  try {
    assert.equal(connection.tools.length, 2);
    const result = await connection.call('echo', { text: 'Local MCP works' });
    assert.deepEqual(result.content, [{ type: 'text', text: 'Local MCP works' }]);
  } finally { await connection.close(); }
});
