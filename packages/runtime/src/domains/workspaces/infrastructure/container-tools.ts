import {
  defineExtension,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import {
  activeCommandGrant,
  ToolApprovals,
  type ToolApprovalService,
} from "../../approvals/infrastructure/pi-tool-approvals.ts";
import { authorizeContainerDispatch } from "./container-workspace.ts";

/** The bot capability is captured by bootstrap, never selected by tool arguments. */
export function createContainerTools(
  environment: (
    conversationId: number,
    operationId: string,
  ) => Promise<ExecutionEnv>,
  approvals: ToolApprovalService,
) {
  const tools: readonly ToolRegistration[] = CodingTools.tools!;
  return defineExtension({
    name: "raphie.workspace",
    sections: [
      section(
        "workspace",
        () =>
          "read, write, edit and bash operate in this bot's container at /workspace. Sessions share persistent files. Writes survive failures and interruptions; there is no rollback. Processes stop when the container expires or a command is aborted. Interrupted operations have unknown outcomes and must not be repeated automatically: inspect files and git status first. Commands have a 30 second deadline, 16 KiB source and 32 KiB output cap. The container has open network, including possible host/LAN access; it is not VM isolation. No host credentials are provided. Use the bot's host-side MCP integrations for authenticated remote actions; their approvals still apply.",
      ),
    ],
    tools: tools.map((tool): ToolRegistration => ({
      ...tool,
      // Pi must never rerun interrupted native effects, even if file writes look
      // repeatable. Stable backend ids are for evidence, not replay permission.
      replay: tool.name === "bash" ? "safe" : "unsafe",
      execute: async (args, api, context) => {
        let claimed = false;
        let authorize: (() => Promise<boolean>) | undefined;
        let approvalId: string | undefined;
        if (tool.name === "bash") {
          const argumentsJson = JSON.stringify(args);
          const fingerprint = new Bun.CryptoHasher("sha256")
            .update(
              JSON.stringify([
                "raphie.workspace.command",
                api.conversationId,
                api.taskId,
                api.callId,
                argumentsJson,
              ]),
            )
            .digest("hex");
          const created = await approvals.ensure(api, context, {
            server: "workspace",
            tool: "bash",
            connectionIdentity: "raphie.workspace.command",
            argumentsJson,
            fingerprint,
          });
          const approved =
            created.status === "pending"
              ? await approvals.wait(api, context, created)
              : created;
          authorize = async () =>
            (claimed = await api.commit(async (tx) => {
              const state = await tx.doc(ToolApprovals);
              const item = state.approvals.find((a) => a.id === approved.id);
              if (
                !item ||
                item.status !== "approved" ||
                item.conversationId !== api.conversationId ||
                item.taskId !== api.taskId ||
                item.fingerprint !== fingerprint ||
                item.argumentsJson !== argumentsJson ||
                !activeCommandGrant(state, item) ||
                context.abortSignal?.aborted ||
                (item.fullAccess &&
                  state.commandModes?.[String(api.conversationId)] !==
                    "full-access")
              )
                return false;
              if (item.execution !== "waiting") return false;
              item.execution = "running";
              return true;
            }, context));
          approvalId = approved.id;
        }
        let env = await environment(
          api.conversationId,
          `${api.conversationId}:${api.taskId}:${api.callId}`,
        );
        if (authorize) {
          const guard = (
            env as ExecutionEnv & {
              [authorizeContainerDispatch]?: (
                claim: () => Promise<boolean>,
              ) => ExecutionEnv;
            }
          )[authorizeContainerDispatch];
          if (!guard)
            throw new Error("Container dispatch authorization unavailable");
          env = guard(authorize);
        }
        const result = await tool
          .execute(args, { ...api, env }, context)
          .catch((error: unknown) => {
            if (!approvalId || claimed) throw error;
            return {
              output: [
                {
                  type: "text" as const,
                  text: "Command authorization is no longer valid or execution was interrupted. Inspect its outcome before retrying.",
                },
              ],
              isError: true,
            };
          });
        if (approvalId && !claimed)
          return {
            output: [
              {
                type: "text" as const,
                text: "Command was rejected or authorization is no longer valid, or a previous execution may have started. Do not repeat an interrupted command; inspect its outcome first.",
              },
            ],
            isError: true,
          };
        if (approvalId)
          await api.commit(async (tx) => {
            const item = (await tx.doc(ToolApprovals)).approvals.find(
              (a) => a.id === approvalId,
            )!;
            item.execution = "done";
          }, context);
        return result;
      },
    })),
  });
}
