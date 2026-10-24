import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { toLlmContent } from "@earendil-works/pi-mcp";

import type { McpClient } from "../../../infrastructure/mcp/client.ts";
import type { Telemetry } from "../../../shared/application/telemetry.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import type { ChatService } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { ToolApprovalService, ToolResult } from "./pi-tool-approvals.ts";
import { ToolApprovals } from "./pi-tool-approvals.ts";

export type McpTools = {
  namespace?: string;
  client: McpClient;
  identity: string;
  documentationTools?: string[];
};

function toolName(namespace: string, original: string) {
  const name = `mcp_${namespace}_${original.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  return name.length <= 64
    ? name
    : `${name.slice(0, 55)}_${new Bun.CryptoHasher("sha256").update(original).digest("hex").slice(0, 8)}`;
}

function normalize(result: Awaited<ReturnType<McpClient["call"]>>): ToolResult {
  const text =
    toLlmContent(result)
      .map((part) =>
        part.type === "text"
          ? part.text
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
  app: {
    toolApprovals: ToolApprovalService;
    telemetry: Telemetry;
    chats: Pick<ChatService, "state">;
  },
  options: McpTools,
) {
  const server = options.client.server?.name ?? "mcp";
  const namespace =
    options.namespace ?? server.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  const tools = options.client.tools.map((tool) =>
    defineTool({
      name: toolName(namespace, tool.name),
      deferred: options.namespace ? true : undefined,
      description: `${tool.description ?? tool.name}\n${options.documentationTools?.includes(tool.name) ? "Documentation lookup." : "Requires the owner to approve the exact arguments before execution."}`,
      parameters: Type.Unsafe<Record<string, unknown>>({
        ...tool.inputSchema,
        type: "object",
        properties: tool.inputSchema.properties ?? {},
      }),
      replay: "safe", // Only this durable gate is replay-safe, not the remote action.
      outputLimits: { maxBytes: 32_000, maxLines: 1000 },
      execute: async (args, api, ctx) => {
        const call = (approvalId?: string) =>
          app.telemetry.run(
            "tool.call",
            { "tool.name": tool.name },
            async (annotate) => {
              const session = (await app.chats.state()).conversations.find(
                (c) => c.id === api.conversationId,
              );
              annotate({
                ...(session ? { "session.id": session.sessionId } : {}),
                ...(approvalId ? { "approval.id": approvalId } : {}),
              });
              return options.client.call(tool.name, args, ctx.abortSignal);
            },
          );
        if (options.documentationTools?.includes(tool.name)) {
          try {
            return output(normalize(await call()));
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
          result = normalize(await call(approved.id));
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
  return defineExtension({
    name: options.namespace ? `raphie.mcp.${options.namespace}` : "raphie.mcp",
    tools,
  });
}
