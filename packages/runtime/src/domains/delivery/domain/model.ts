import type { Approval } from "../../approvals/domain/file-approval.ts";
import type { ToolApproval } from "../../approvals/domain/tool-approval.ts";

export type DeliveryIntent = { id: string; threadId: string } & (
  | { source: "chat"; text: string }
  | {
      source: "tool";
      kind: "approval" | "resolved";
      approval: ToolApproval;
      originalMessageId: string | null;
    }
  | {
      source: "file";
      kind: "approval" | "resolved" | "result";
      approval: Approval;
      originalMessageId: string | null;
    }
);

export type DeliveryOperation = {
  id: string;
  payload: string;
  status: "pending" | "sending" | "sent" | "uncertain";
  messageId: string | null;
};

export type DeliveryPlan = {
  id: string;
  source: DeliveryIntent["source"];
  operations: DeliveryOperation[];
};
