import type { Attachment as FileRef } from "@raphie/contracts";

export type Source = "web" | "discord";

export type Approval = {
  id: string;
  requestKey: string;
  fingerprint: string;
  text: string;
  source: Source;
  connectionId?: string;
  discordUserId?: string;
  files: FileRef[];
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedVia: Source | null;
  completedAt: number | null;
  results: FileRef[];
  effectCount: number;
};

export type Delivery = {
  id: string;
  approvalId: string;
  kind: "approval" | "resolved" | "result";
  threadId: string;
  connectionId?: string;
  status: "pending" | "sending" | "sent" | "uncertain";
  messageId: string | null;
  error: string | null;
};

export type GatewayState = { approvals: Approval[]; deliveries: Delivery[] };
