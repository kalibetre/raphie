import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import type { WorkspaceSnapshot } from "@raphie/contracts";

import { Activity } from "../../domains/activity/infrastructure/pi-activity-journal.ts";
import type { McpTools } from "../../domains/approvals/infrastructure/mcp-approval-gate.ts";
import type { ToolApprovalService } from "../../domains/approvals/infrastructure/pi-tool-approvals.ts";
import type { ChatService } from "../../domains/conversations/infrastructure/pi-conversation-service.ts";
import type { Observations } from "../../domains/conversations/infrastructure/pi-observations.ts";

type WorkspaceSource = {
  harness: Harness;
  chats: ChatService;
  toolApprovals: ToolApprovalService;
  observations: Observations;
  options: { mcp?: McpTools; mcpError?: boolean };
};

export async function snapshot(
  app: WorkspaceSource,
): Promise<WorkspaceSnapshot> {
  const chats = await app.chats.state();
  const tools = await app.toolApprovals.state();
  return {
    ...chats,
    // Compatibility DTO only; channel associations live in ChannelBindings.
    conversations: chats.conversations.map((c) => ({
      ...c,
      discordThreadId: null,
    })),
    model: app.chats.model ?? null,
    mcp: {
      connected: !!app.options.mcp,
      error: app.options.mcpError ?? false,
      server: app.options.mcp?.client.server?.name ?? null,
      toolCount: app.options.mcp?.client.tools.length ?? 0,
    },
    toolApprovals: tools.approvals.map(
      ({ taskId, fingerprint, result, ...proposal }) => proposal,
    ),
    uncertainToolDeliveries: tools.deliveries
      .filter((d) => d.status === "uncertain")
      .map((d) => d.approvalId),
    live: Object.fromEntries(app.observations.live),
    activity: (await app.harness.snapshot(Activity, context))?.events ?? [],
  };
}
