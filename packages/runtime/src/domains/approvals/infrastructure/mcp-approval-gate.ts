import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

import type { McpClient } from "../../../infrastructure/mcp/client.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import type { ToolApprovalService } from "./pi-tool-approvals.ts";
import type { ToolResult } from "./pi-tool-approvals.ts";
import { ToolApprovals } from "./pi-tool-approvals.ts";

export type McpTools = {
  client: McpClient;
  identity: string;
  documentationTools?: string[];
};

function normalize(result: Awaited<ReturnType<McpClient["call"]>>): ToolResult {
  const text =
    result.content
      ?.map((part) =>
        part.type === "text"
          ? part.text
          : part.type === "resource_link"
            ? `Resource: ${part.name} (${part.uri})`
            : `[${part.type} content is not rendered in this text interface]`,
      )
      .join("\n") || JSON.stringify(result.structuredContent ?? {});
  return {
    text:
      text.length > 30_000
        ? `${text.slice(0, 30_000)}\n[Output truncated. Ask the server for a smaller result.]`
        : text,
    isError: !!result.isError,
  };
}

function output(result: ToolResult) {
  return {
    output: [{ type: "text" as const, text: result.text }],
    isError: result.isError,
  };
}

export function createMcpTools(
  app: { toolApprovals: ToolApprovalService },
  options: McpTools,
) {
  const server = options.client.server?.name ?? "mcp";
  const namespace = server.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  const tools = options.client.tools.map((tool) =>
    defineTool({
      name: `mcp_${namespace}_${tool.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      description: `${tool.description ?? tool.name}\n${options.documentationTools?.includes(tool.name) ? "Documentation lookup." : "Requires the owner to approve the exact arguments before execution."}`,
      parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
      replay: "safe", // Only this durable gate is replay-safe, not the remote action.
      outputLimits: { maxBytes: 32_000, maxLines: 1000 },
      execute: async (args, api, ctx) => {
        if (options.documentationTools?.includes(tool.name)) {
          try {
            return output(
              normalize(
                await options.client.call(tool.name, args, ctx.abortSignal),
              ),
            );
          } catch {
            return output({
              text: "MCP documentation lookup failed. Check the connection.",
              isError: true,
            });
          }
        }
        const argumentsJson = JSON.stringify(args, null, 2);
        if (Buffer.byteLength(argumentsJson) > 64 * 1024)
          return output({
            text: "Tool arguments are too large to review. Use a smaller request.",
            isError: true,
          });
        const fingerprint = new Bun.CryptoHasher("sha256")
          .update(JSON.stringify([options.identity, tool.name, argumentsJson]))
          .digest("hex");
        const created = await app.toolApprovals.ensure(api, ctx, {
          server,
          tool: tool.name,
          argumentsJson,
          fingerprint,
        });
        const approved = await app.toolApprovals.wait(api, ctx, created);
        if (approved.status !== "approved")
          return output({
            text: `Tool request ${approved.status}. No call was sent. Do not retry unless the owner requests it.`,
            isError: true,
          });
        const claim = await api.commit(async (tx) => {
          const item = (await tx.doc(ToolApprovals)).approvals.find(
            (a) => a.id === approved.id,
          )!;
          if (item.execution === "done")
            return { kind: "cached" as const, result: item.result! };
          if (item.execution !== "waiting")
            return { kind: "uncertain" as const };
          item.execution = "running";
          record(
            await tx.doc(Activity),
            "action.claimed",
            `Executing ${item.tool}`,
            {
              conversationId: item.conversationId,
              operationId: item.id,
              pluginId: server,
            },
          );
          return { kind: "claimed" as const };
        }, ctx);
        if (claim.kind === "cached") return output(claim.result);
        if (claim.kind === "uncertain")
          return output({
            text: "The previous call may already have executed. Its outcome is unknown. Do not repeat it; ask the owner to inspect the external service first.",
            isError: true,
          });
        let result;
        try {
          result = normalize(
            await options.client.call(tool.name, args, ctx.abortSignal),
          );
        } catch {
          if (ctx.abortSignal?.aborted)
            throw new Error("MCP invocation interrupted.");
          await api.commit(async (tx) => {
            (await tx.doc(ToolApprovals)).approvals.find(
              (a) => a.id === approved.id,
            )!.execution = "uncertain";
            record(
              await tx.doc(Activity),
              "action.uncertain",
              "Action outcome is unknown; automatic repeat blocked",
              {
                conversationId: approved.conversationId,
                operationId: approved.id,
              },
            );
          }, ctx);
          return output({
            text: "MCP call failed or its outcome is unknown. Do not repeat it; ask the owner to inspect the external service first.",
            isError: true,
          });
        }
        await api.commit(async (tx) => {
          const item = (await tx.doc(ToolApprovals)).approvals.find(
            (a) => a.id === approved.id,
          )!;
          item.execution = "done";
          item.result = result;
          record(
            await tx.doc(Activity),
            "action.completed",
            `${item.tool} returned a result`,
            {
              conversationId: item.conversationId,
              operationId: item.id,
              pluginId: server,
              details: result,
            },
          );
        }, ctx);
        return output(result);
      },
    }),
  );
  if (
    new Set(tools.map((t) => t.name)).size !== tools.length ||
    tools.some((t) => t.name.length > 64)
  )
    throw new Error("MCP tool names are ambiguous or too long.");
  return defineExtension({ name: "raphie.mcp", tools });
}
