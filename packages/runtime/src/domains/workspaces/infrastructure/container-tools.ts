import {
  defineExtension,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { CodingTools } from "@earendil-works/pi-durable/tools";

/** The bot capability is captured by bootstrap, never selected by tool arguments. */
export function createContainerTools(
  environment: (
    conversationId: number,
    operationId: string,
  ) => Promise<ExecutionEnv>,
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
      replay: "unsafe",
      execute: async (args, api, context) => {
        const env = await environment(
          api.conversationId,
          `${api.conversationId}:${api.taskId}:${api.callId}`,
        );
        return tool.execute(args, { ...api, env }, context);
      },
    })),
  });
}
