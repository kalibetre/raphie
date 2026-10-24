import {
  McpClient as PiMcpClient,
  StdioTransport,
  StreamableHttpTransport,
} from "@earendil-works/pi-mcp";

export type McpConnection =
  | { transport: "http"; url: string; token?: string }
  | {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };

/** Pi owns initialization, pagination, cancellation, HTTP resumption and shutdown. */
export async function connectMcp(config: McpConnection) {
  const client = new PiMcpClient({
    name: "raphie",
    version: "0.1.0",
    requestTimeoutMs: 15_000,
  });
  let transport;
  if (config.transport === "stdio") {
    transport = new StdioTransport({
      command: config.command,
      args: config.args,
      env: { PATH: process.env.PATH ?? "", ...config.env },
      inheritEnv: false,
      stderr: "pipe",
    });
  } else {
    const url = new URL(config.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Use an HTTP(S) MCP URL without embedded credentials.");
    if (
      config.token &&
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Bearer authentication requires HTTPS for remote servers.",
      );
    transport = new StreamableHttpTransport({
      url: config.url,
      headers: config.token
        ? { Authorization: `Bearer ${config.token}` }
        : undefined,
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: "error" });
        if (init?.method === "DELETE" && !response.ok)
          console.warn(
            "MCP remote session cleanup failed; closing the local connection.",
          );
        return response;
      },
    });
  }
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return {
      server: client.serverInfo,
      tools,
      call: async (
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal,
      ) => {
        if (!tools.some((t) => t.name === name))
          throw new Error("Tool was not advertised by the connected server.");
        return client.callTool(name, args, { signal, timeoutMs: 30_000 });
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

export type McpClient = Awaited<ReturnType<typeof connectMcp>>;
