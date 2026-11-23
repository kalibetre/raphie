import { toLlmContent } from "@earendil-works/pi-mcp";

import type { McpClient } from "../../../infrastructure/mcp/client.ts";
import { appsFromSkills } from "../domain/connected-services.ts";

/** How long a gateway has to list its apps before it is left unlisted. */
const LISTING_TIMEOUT_MS = 8000;

/** The server Raphie knows how to ask: Executor lists its apps with `skills`. */
const GATEWAY = "executor";

/**
 * The apps a gateway holds, none when it holds none, or undefined when the
 * server is not one or does not give a list. Executor's own tools are
 * `search` and `call`, so the calendar and mail behind it are invisible
 * until it is asked; its `skills` tool, called with nothing, lists every
 * app without acting on any. Never throws: a connection works without its list.
 */
export async function gatewayApps(
  client: McpClient,
): Promise<string[] | undefined> {
  if (
    client.server?.name !== GATEWAY ||
    !client.tools.some((tool) => tool.name === "skills")
  )
    return undefined;
  try {
    const result = await client.call(
      "skills",
      {},
      AbortSignal.timeout(LISTING_TIMEOUT_MS),
    );
    if (result.isError) return undefined;
    const text = toLlmContent(result)
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    const listing: unknown = result.structuredContent ?? JSON.parse(text);
    return appsFromSkills(listing, GATEWAY);
  } catch {
    return undefined;
  }
}
