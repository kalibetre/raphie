import type { ApprovalStatus } from "@raphie/contracts";

export type Decision = "approved" | "rejected";

export function isDecision(value: unknown): value is Decision {
  return value === "approved" || value === "rejected";
}

/** Settled decisions are idempotent; expiry always wins over a late decision. */
export function decideApproval(
  status: ApprovalStatus,
  expiresAt: number,
  decision: Decision,
  now: number,
): ApprovalStatus {
  if (status !== "pending") return status;
  return now >= expiresAt ? "expired" : decision;
}
