import type { CardElement } from "chat";

import type { Approval } from "../../domains/approvals/domain/file-approval.ts";
import type { ToolApproval } from "../../domains/approvals/domain/tool-approval.ts";

export function toolApprovalCard(item: ToolApproval): CardElement {
  const pending = item.status === "pending" && Date.now() < item.expiresAt;
  return {
    type: "card",
    title: pending
      ? `Approve ${item.server}: ${item.tool}`
      : `Tool request ${item.status}`,
    children: [
      {
        type: "text",
        content: `Review the attached JSON for the exact arguments. Approval permits one call, which may change external data.\nExpires: ${new Date(item.expiresAt).toISOString()}\nRequest: ${item.id}`,
      },
      {
        type: "actions",
        children: [
          {
            type: "button",
            id: "raphie-tool-approve",
            value: item.id,
            label: "Approve once",
            style: "primary",
            disabled: !pending,
          },
          {
            type: "button",
            id: "raphie-tool-reject",
            value: item.id,
            label: "Decline",
            style: "danger",
            disabled: !pending,
          },
        ],
      },
    ],
  };
}

export function approvalCard(approval: Approval): CardElement {
  const pending =
    approval.status === "pending" && Date.now() < approval.expiresAt;
  return {
    type: "card",
    title: pending ? "Approve file copy" : `Request ${approval.status}`,
    children: [
      {
        type: "text",
        content: approval.text.slice(0, 1500) || "Attached files",
      },
      {
        type: "text",
        content: `${approval.files.length ? approval.files.map((f) => f.name).join(", ") : "Create approved-note.txt"}\nExpires: ${new Date(approval.expiresAt).toISOString()}\nRequest: ${approval.id}`,
      },
      {
        type: "actions",
        children: [
          {
            type: "button",
            id: "raphie-approve",
            value: approval.id,
            label: "Approve",
            style: "primary",
            disabled: !pending,
          },
          {
            type: "button",
            id: "raphie-reject",
            value: approval.id,
            label: "Decline",
            style: "danger",
            disabled: !pending,
          },
        ],
      },
    ],
  };
}
