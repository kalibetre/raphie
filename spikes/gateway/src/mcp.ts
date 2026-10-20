import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export type McpConnection =
  | { transport: 'http' | 'sse'; url: string; token?: string }
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };

/** One MCP connection; credentials stay in the transport, outside model context. */
export async function connectMcp(config: McpConnection) {
  const client = new Client({ name: 'raphie', version: '0.1.0' }, { listMaxPages: 32 });
  let transport;
  if (config.transport === 'stdio') {
    transport = new StdioClientTransport({ command: config.command, args: config.args, env: config.env, stderr: 'ignore' });
  } else {
    const url = new URL(config.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) MCP URL without embedded credentials.');
    if (config.token && url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Bearer authentication requires HTTPS for remote servers.');
    const options = { requestInit: { redirect: 'error' as const },
      ...(config.token ? { authProvider: { token: async () => config.token! } } : {}) };
    transport = config.transport === 'http' ? new StreamableHTTPClientTransport(url, options) : new SSEClientTransport(url, options);
  }
  try {
    await client.connect(transport, { timeout: 15_000 });
    const inventory = await client.listTools({}, { timeout: 15_000 });
    return {
      server: client.getServerVersion(), tools: inventory.tools,
      async call(name: string, args: Record<string, unknown>) {
        if (!inventory.tools.some(t => t.name === name)) throw new Error('Tool was not advertised by the connected server.');
        return client.callTool({ name, arguments: args }, { timeout: 30_000 });
      },
      async close() {
        try { if (transport instanceof StreamableHTTPClientTransport) await transport.terminateSession(); }
        finally { await client.close(); }
      },
    };
  } catch (error) { await client.close().catch(() => {}); throw error; }
}
