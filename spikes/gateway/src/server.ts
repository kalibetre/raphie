import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { InputError } from './state.ts';
import { MAX_FILE_BYTES } from './files.ts';
import type { Gateway } from './gateway.ts';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/experiment', ['experiment.html', 'text/html; charset=utf-8']],
  ['/experiment.js', ['experiment.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

async function body(req: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new InputError('Request is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function startServer(app: Gateway, options: {
  port?: number; discordConfigured?: boolean;
  webhook?: (request: Request) => Promise<Response>;
} = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'POST' && path === '/webhooks/discord' && options.webhook) {
        const payload = await body(req, 1024 * 1024);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
        const response = await options.webhook(new Request('http://localhost/webhooks/discord', { method: 'POST', headers, body: payload }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      // Loopback-only UI, including Host validation against DNS rebinding.
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host ?? '')) throw new InputError('Unrecognized host.', 403);
      if (req.method !== 'GET') {
        if (req.headers['x-raphie-client'] !== 'web' ||
          (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin))) {
          throw new InputError('Unrecognized request origin.', 403);
        }
      }
      if (req.method === 'GET' && assets.has(path)) {
        const [name, type] = assets.get(path)!;
        res.setHeader('Content-Type', type);
        res.end(await readFile(new URL(`../web/${name}`, import.meta.url)));
      } else if (req.method === 'GET' && path === '/api/state') {
        json(res, { ...await app.state(), discordConfigured: options.discordConfigured ?? false });
      } else if (req.method === 'GET' && path === '/api/chats') {
        const tools = await app.toolApprovals.state();
        json(res, { ...await app.chats.state(), model: app.chats.model ?? null,
          mcp: { connected: !!app.options.mcp, error: app.options.mcpError ?? false,
            server: app.options.mcp?.client.server?.name ?? null, toolCount: app.options.mcp?.client.tools.length ?? 0 },
          toolApprovals: tools.approvals.map(({ taskId, fingerprint, result, ...proposal }) => proposal),
          uncertainToolDeliveries: tools.deliveries.filter(d => d.status === 'uncertain').map(d => d.approvalId) });
      } else if (req.method === 'POST' && /^\/api\/tool-approvals\/[a-f0-9-]{36}$/.test(path)) {
        const data = JSON.parse((await body(req, 1024)).toString());
        json(res, { status: await app.toolApprovals.decide(path.split('/').at(-1)!, data.decision, 'owner', 'web') });
      } else if (req.method === 'GET' && /^\/api\/tool-approvals\/[a-f0-9-]{36}\.json$/.test(path)) {
        const id = path.split('/').at(-1)!.slice(0, -5);
        const item = (await app.toolApprovals.state()).approvals.find(a => a.id === id);
        if (!item) throw new InputError('Tool approval not found.', 404);
        res.setHeader('Content-Disposition', `attachment; filename="tool-request-${id}.json"`);
        json(res, { server: item.server, tool: item.tool, arguments: JSON.parse(item.argumentsJson) });
      } else if (req.method === 'POST' && path === '/api/chat') {
        const data = JSON.parse((await body(req, 20_000)).toString());
        const result = await app.chats.send({ source: 'web', actor: 'owner', eventId: data.eventId,
          text: data.text, conversationId: data.conversationId });
        json(res, result, 201);
      } else if (req.method === 'GET' && path.startsWith('/api/files/')) {
        const id = path.slice('/api/files/'.length);
        const state = await app.state();
        const file = state.approvals.flatMap(a => [...a.files, ...a.results]).find(f => f.id === id);
        if (!file) throw new InputError('File not found.', 404);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        res.end(await app.files.read(id));
      } else if (req.method === 'POST' && path === '/api/messages') {
        const payload = await body(req, MAX_FILE_BYTES * 4 + 64 * 1024);
        const request = new Request('http://localhost', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: payload });
        const form = await request.formData();
        const uploaded = form.getAll('files');
        if (uploaded.length > 4) throw new InputError('Attach at most four files.');
        const files = [];
        for (const item of uploaded) {
          if (!(item instanceof File)) throw new InputError('Invalid attachment.');
          if (item.size > MAX_FILE_BYTES) throw new InputError('Files must be 8 MiB or smaller.', 413);
          files.push(await app.files.put(item.name, new Uint8Array(await item.arrayBuffer())));
        }
        const id = await app.accept({ source: 'web', eventId: String(form.get('eventId') ?? ''), actor: 'owner', text: String(form.get('text') ?? ''), files });
        json(res, { id }, 201);
      } else if (req.method === 'POST' && /^\/api\/approvals\/[a-f0-9-]{36}$/.test(path)) {
        const data = JSON.parse((await body(req, 1024)).toString());
        const status = await app.decide(path.split('/').at(-1)!, data.decision, 'owner', 'web');
        json(res, { status });
      } else throw new InputError('Not found.', 404);
    } catch (error) {
      json(res, { error: error instanceof InputError ? error.message : 'Request failed. Check the request and try again.' },
        error instanceof InputError ? error.status : 400);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4315, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
