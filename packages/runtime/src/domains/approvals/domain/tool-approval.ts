import type { Channel as Source } from "@raphie/contracts";

import type { ReplyDestination } from "../../channels/domain/binding.ts";

export type ToolResult = { text: string; isError: boolean };

export type ToolApproval = {
  id: string;
  taskId: number;
  conversationId: number;
  replyTo?: ReplyDestination | null;
  discordUserId?: string;
  fingerprint: string;
  server: string;
  tool: string;
  argumentsJson: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedVia: Source | null;
  execution: "waiting" | "running" | "done" | "uncertain";
  result: ToolResult | null;
};

export type ToolDelivery = {
  id: string;
  approvalId: string;
  threadId: string;
  connectionId?: string;
  kind: "approval" | "resolved";
  status: "pending" | "sending" | "sent" | "uncertain";
  messageId: string | null;
};
