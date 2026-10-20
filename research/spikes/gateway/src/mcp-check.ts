import { connectMcp } from './mcp.ts';

async function check() {
  const transport = process.env.MCP_TRANSPORT ?? 'http';
  let connection;
  if (transport === 'stdio') {
    if (!process.env.MCP_COMMAND) throw new Error('Set MCP_COMMAND for stdio.');
    const args: unknown = JSON.parse(process.env.MCP_ARGS ?? '[]');
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) throw new Error('MCP_ARGS must be a JSON array of strings.');
    connection = await connectMcp({ transport, command: process.env.MCP_COMMAND, args });
  } else if (transport === 'http' || transport === 'sse') {
    const url = process.argv[2] ?? process.env.MCP_URL;
    if (!url) throw new Error('Pass an MCP URL or set MCP_URL.');
    connection = await connectMcp({ transport, url, token: process.env.MCP_BEARER_TOKEN });
  } else throw new Error('MCP_TRANSPORT must be http, sse, or stdio.');
  try {
    console.log(JSON.stringify({ connected: true, server: connection.server,
      toolCount: connection.tools.length, tools: connection.tools.map(t => t.name) }, null, 2));
    if (process.env.MCP_PROBE_TOOL) {
      const args: unknown = JSON.parse(process.env.MCP_PROBE_ARGS ?? '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MCP_PROBE_ARGS must be a JSON object.');
      const result = await connection.call(process.env.MCP_PROBE_TOOL, args as Record<string, unknown>);
      console.log(JSON.stringify({ probeTool: process.env.MCP_PROBE_TOOL, isError: !!result.isError,
        contentTypes: result.content?.map(c => c.type) ?? [] }));
      if (result.isError) process.exitCode = 1;
    }
  } finally { await connection.close(); }
}

await check().catch(() => {
  // Transport/server errors can contain headers or URLs with credentials.
  console.error('MCP check failed. Check the endpoint, transport, token, and probe arguments.');
  process.exitCode = 1;
});
