export function rpcResponse(message: {
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}) {
  if (message.id === undefined) return null;
  let result;
  if (message.method === "initialize")
    result = {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "fixture-mcp", version: "1.0.0" },
      capabilities: { tools: {} },
    };
  else if (message.method === "tools/list")
    result = message.params?.cursor
      ? {
          tools: [
            {
              name: "server_info",
              description: "Read server information",
              inputSchema: { type: "object" },
            },
          ],
        }
      : {
          tools: [
            {
              name: "echo",
              description: "Echo text",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
          nextCursor: "last",
        };
  else if (message.method === "tools/call")
    result = {
      content: [
        {
          type: "text",
          text: String(
            (message.params?.arguments as { text?: string })?.text ?? "fixture",
          ),
        },
      ],
    };
  else if (message.method === "ping") result = {};
  else
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" },
    };
  return { jsonrpc: "2.0", id: message.id, result };
}
