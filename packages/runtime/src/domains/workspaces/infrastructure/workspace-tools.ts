import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";

import { InputError } from "../../../shared/application/input-error.ts";
import type { BotWorkspace } from "./bot-workspace.ts";

/** Capability is closed over the bot container; no model-selected IDs or paths. */
export function createWorkspaceTools(
  workspace: BotWorkspace,
  session: (conversationId: number) => Promise<string | undefined>,
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
        parameters: Type.Object(
          { command: Type.String({ minLength: 1, maxLength: 16384 }) },
          { additionalProperties: false },
        ),
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
            const result = await workspace.execute(
              sessionId,
              `${api.conversationId}:${api.taskId}:${api.callId}`,
              args.command,
              ctx.abortSignal,
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
