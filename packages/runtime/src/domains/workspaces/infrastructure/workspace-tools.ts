import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  activeCommandGrant,
  ToolApprovals,
  type ToolApprovalService,
} from "../../approvals/infrastructure/pi-tool-approvals.ts";
import type { RuntimeWorkspace } from "./runtime-workspace.ts";

/** Capability is closed over the bot container; no model-selected IDs or paths. */
export function createWorkspaceTools(
  workspace: Pick<RuntimeWorkspace, "execute">,
  session: (conversationId: number) => Promise<string | undefined>,
  approvals: ToolApprovalService,
) {
  return defineExtension({
    name: "raphie.workspace",
    sections: [
      section(
        "workspace",
        () =>
          "workspace_exec runs supported shell-like commands over this bot's persistent virtual /workspace. Sessions of this bot share files. Only files survive: shell state, processes and /tmp do not. No host files, credentials, network, native binaries, Node or Python are available. Use host-side MCP tools for integrations; their approvals still apply. An execution commits its files only when the shell exits zero. Failed, timed-out or interrupted executions discard all changes. Bound each command to 5 seconds, 16 KiB source, 32 KiB output and 8 MiB files / 1024 entries. This is logical separation, not an OS/VM sandbox. Report success only after committed:true.",
      ),
    ],
    tools: [
      defineTool({
        name: "workspace_exec",
        description:
          "Run a bounded shell command in this bot's persistent /workspace, shared across its conversations. Read/write files directly on the owner's request. No host filesystem or external actions. Successful exit commits the checkpoint; failure rolls back this execution's file changes.",
        parameters: obj({ command: str({ minLength: 1, maxLength: 16384 }) }),
        replay: "safe", // Checkpoint and stable tool receipt commit in one SQLite transaction.
        outputLimits: { maxBytes: 80_000, maxLines: 2000 },
        execute: async (args, api, ctx) => {
          try {
            const sessionId = await session(api.conversationId);
            if (!sessionId)
              throw new InputError(
                "Workspace execution requires an active session turn.",
                409,
              );
            const argumentsJson = JSON.stringify({ command: args.command });
            const fingerprint = new Bun.CryptoHasher("sha256")
              .update(
                JSON.stringify([
                  "raphie.workspace.command",
                  api.conversationId,
                  api.callId,
                  argumentsJson,
                ]),
              )
              .digest("hex");
            const created = await approvals.ensure(api, ctx, {
              server: "workspace",
              tool: "workspace_exec",
              connectionIdentity: "raphie.workspace.command",
              argumentsJson,
              fingerprint,
            });
            const approved =
              created.status === "pending"
                ? await approvals.wait(api, ctx, created)
                : created;
            const authorize = async () => {
              const authorized = await api.commit(async (tx) => {
                const state = await tx.doc(ToolApprovals);
                const item = state.approvals.find((a) => a.id === approved.id);
                return (
                  !!item &&
                  item.status === "approved" &&
                  item.conversationId === api.conversationId &&
                  item.taskId === api.taskId &&
                  item.fingerprint === fingerprint &&
                  item.argumentsJson === argumentsJson &&
                  item.connectionIdentity === "raphie.workspace.command" &&
                  activeCommandGrant(state, item) &&
                  (!item.fullAccess ||
                    state.commandModes?.[String(api.conversationId)] ===
                      "full-access") &&
                  !ctx.abortSignal?.aborted
                );
              }, ctx);
              if (!authorized)
                throw new InputError(
                  "Command authorization rejected, expired, or no longer valid. No command executed.",
                  403,
                );
            };
            await authorize();
            const result = await workspace.execute(
              sessionId,
              `${api.conversationId}:${api.taskId}:${api.callId}`,
              args.command,
              ctx.abortSignal,
              authorize,
            );
            return {
              output: [{ type: "text" as const, text: JSON.stringify(result) }],
              isError: !result.committed,
            };
          } catch (error) {
            return {
              output: [
                {
                  type: "text" as const,
                  text:
                    error instanceof InputError
                      ? error.message
                      : "Workspace execution interrupted or unavailable. Do not assume files changed; inspect them before continuing.",
                },
              ],
              isError: true,
            };
          }
        },
      }),
    ],
  });
}
