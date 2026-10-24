import type { McpConnection } from "./client.ts";

/** Loaded by Varlock bootstrap only. Never read raw env files or return credentials. */
export function legacyMcpConfig(
  env: NodeJS.ProcessEnv,
): McpConnection | undefined {
  const mode = env.MCP_TRANSPORT || "http";
  if (!env.MCP_URL && !env.MCP_COMMAND) return undefined;
  if (mode === "stdio") {
    if (!env.MCP_COMMAND)
      throw new Error("Legacy MCP stdio requires MCP_COMMAND.");
    const args: unknown = JSON.parse(env.MCP_ARGS || "[]");
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string"))
      throw new Error("Legacy MCP_ARGS must be an array of strings.");
    return { transport: mode, command: env.MCP_COMMAND, args };
  }
  if (mode !== "http")
    throw new Error(
      "Legacy MCP transport is unsupported. Configure Streamable HTTP or stdio explicitly; existing configuration was preserved.",
    );
  if (!env.MCP_URL) throw new Error("Legacy MCP HTTP requires MCP_URL.");
  return { transport: mode, url: env.MCP_URL, token: env.MCP_BEARER_TOKEN };
}
