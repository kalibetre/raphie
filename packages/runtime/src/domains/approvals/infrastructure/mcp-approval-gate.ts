import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import {
  JSON_RPC_ERROR_CODES,
  McpError,
  McpTimeoutError,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import type { Schema } from "@earendil-works/pi-schema";

import type { McpClient } from "../../../infrastructure/mcp/client.ts";
import type { Telemetry } from "../../../shared/application/telemetry.ts";
import { redact } from "../../../shared/infrastructure/redaction.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import type { ChatService } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { ToolApprovalService, ToolResult } from "./pi-tool-approvals.ts";
import { ToolApprovals } from "./pi-tool-approvals.ts";

export type McpTools = {
  /** The owner's name for the connection, and what they use it for. */
  name?: string;
  purpose?: string;
  namespace?: string;
  client: McpClient;
  identity: string;
  legacyIdentity?: string;
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

/** What a failed call's error said, on one line and without saved secrets. */
function saidBy(error: unknown) {
  // Our own complaint about a malformed answer uses the same error type.
  if (
    !(error instanceof McpError) ||
    error.code === JSON_RPC_ERROR_CODES.invalidRequest
  )
    return "";
  const text = JSON.parse(redact(error.message.slice(0, 2000))) as string;
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}

/**
 * What to tell the bot when a service refused a call, or nothing when the
 * failure was not a refusal. A refusal is the service's answer that it
 * does not know the tool or its arguments: the call did not run.
 */
function refusalOf(error: unknown) {
  if (
    !(error instanceof McpError) ||
    (error.code !== JSON_RPC_ERROR_CODES.invalidParams &&
      error.code !== JSON_RPC_ERROR_CODES.methodNotFound)
  )
    return undefined;
  const said = saidBy(error);
  return `The service refused the call and did not run it${said ? `: ${said}` : "."} Correct the request before trying again.`;
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
  const label = options.name ? `${options.name}: ` : "";
  const about =
    options.name && options.purpose
      ? `\nPart of ${options.name}, which the owner uses for: ${options.purpose}`
      : "";
  const tools = options.client.tools.map((tool) =>
    defineTool({
      name: toolName(namespace, tool.name),
      deferred: options.namespace ? true : undefined,
      // The name and purpose are what a tool search for "calendar" matches
      // when the tool itself is a gateway's generic "search" or "call".
      description: `${label}${tool.description ?? tool.name}${about}\n${options.documentationTools?.includes(tool.name) ? "Documentation lookup." : "Requires the owner to approve the exact arguments before execution."}`,
      parameters: {
        ...tool.inputSchema,
        type: "object",
        properties: tool.inputSchema.properties ?? {},
      } as Schema<Record<string, unknown>>,
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
          connectionIdentity: options.identity,
          legacyFingerprint: options.legacyIdentity
            ? new Bun.CryptoHasher("sha256")
                .update(
                  JSON.stringify([
                    options.legacyIdentity,
                    tool.name,
                    argumentsJson,
                  ]),
                )
                .digest("hex")
            : undefined,
        });
        const approved =
          created.status === "pending"
            ? await app.toolApprovals.wait(api, ctx, created)
            : created;
        if (approved.status !== "approved")
          return output({
            text: `Tool request ${approved.status}. No call was sent. Do not retry unless the owner requests it.`,
            isError: true,
          });
        const claim = await api.commit(async (tx) => {
          const state = await tx.doc(ToolApprovals);
          const item = state.approvals.find((a) => a.id === approved.id);
          if (
            !item ||
            item.conversationId !== api.conversationId ||
            item.taskId !== api.taskId ||
            item.fingerprint !== fingerprint ||
            item.status !== "approved" ||
            (item.fullAccess &&
              state.commandModes?.[String(api.conversationId)] !==
                "full-access") ||
            !!item.grantId
          )
            return { kind: "unauthorized" as const };
          if (item.execution === "done")
            return { kind: "cached" as const, result: item.result! };
          if (item.execution !== "waiting")
            return { kind: "uncertain" as const };
          if (
            item.grantId &&
            !state.grants?.some(
              (g) =>
                g.id === item.grantId &&
                !g.revoked &&
                g.conversationId === api.conversationId &&
                g.connectionIdentity === options.identity &&
                g.tool === tool.name,
            )
          )
            return { kind: "unauthorized" as const };
          if (ctx.abortSignal?.aborted)
            return { kind: "unauthorized" as const };
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
        if (claim.kind === "unauthorized")
          return output({
            text: "Tool authorization is no longer valid. No call was sent.",
            isError: true,
          });
        if (claim.kind === "cached") return output(claim.result);
        if (claim.kind === "uncertain")
          return output({
            text: "The previous call may already have executed. Its outcome is unknown. Do not repeat it; ask the owner to inspect the external service first.",
            isError: true,
          });
        let result: ToolResult;
        try {
          result = normalize(await call(approved.id));
        } catch (error) {
          if (ctx.abortSignal?.aborted)
            throw new Error("MCP invocation interrupted.");
          // The service answered, and its answer was a refusal: the call
          // did not run, so it is a result like any other and the bot can
          // correct its arguments.
          const refusal = refusalOf(error);
          if (refusal) {
            result = { text: refusal, isError: true };
            await api.commit(async (tx) => {
              const item = (await tx.doc(ToolApprovals)).approvals.find(
                (a) => a.id === approved.id,
              )!;
              item.execution = "done";
              item.result = result;
              record(
                await tx.doc(Activity),
                "action.completed",
                `${item.tool} was refused by the service`,
                {
                  conversationId: item.conversationId,
                  operationId: item.id,
                  pluginId: server,
                  details: result,
                },
              );
            }, ctx);
            return output(result);
          }
          const said = saidBy(error);
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
            text:
              error instanceof McpTimeoutError
                ? `The service did not answer within ${Math.round(error.timeoutMs / 1000)} seconds, so the call may still be running or may have finished. Its outcome is unknown. Do not repeat it; check the service for the result, or ask the owner to.`
                : said
                  ? `The service reported an error: ${said} Whether the call took effect is unknown. Do not repeat it unchanged; check the service first, or ask the owner to.`
                  : "MCP call failed or its outcome is unknown. Do not repeat it; ask the owner to inspect the external service first.",
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
