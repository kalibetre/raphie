import type { Channel as Source } from "@raphie/contracts";

export type ToolResult = { text: string; isError: boolean };

export type ToolApproval = {
  id: string;
  taskId: number;
  conversationId: number;
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
  kind: "approval" | "resolved";
  status: "pending" | "sending" | "sent" | "uncertain";
  messageId: string | null;
};
