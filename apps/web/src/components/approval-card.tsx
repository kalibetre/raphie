import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, Check, X } from "lucide-react";
import { api, type Approval } from "../lib/api";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
export function ApprovalCard({ item }: { item: Approval }) {
  const decision = useMutation({
    mutationFn: (value: "approved" | "rejected") =>
      api<{ status: string }>(`/api/tool-approvals/${item.id}`, {
        decision: value,
      }),
  });
  const expired = item.expiresAt <= Date.now();
  const pending = item.status === "pending" && !expired;
  const state = item.status === "pending" && expired ? "expired" : item.status;
  return (
    <section
      className="approval-card"
      aria-label={`Tool request: ${item.tool}`}
    >
      <div className="approval-heading">
        <ShieldCheck size={18} />
        <strong>
          {pending ? "Your approval is needed" : `Tool request ${state}`}
        </strong>
        <Badge variant="outline">
          {item.execution === "uncertain" ? "Outcome unknown" : state}
        </Badge>
      </div>
      <p>
        <strong>{item.server}</strong> wants to run <code>{item.tool}</code>.
      </p>
      <details open={pending}>
        <summary>Review exact arguments</summary>
        <pre>{item.argumentsJson}</pre>
      </details>
      <div className="approval-actions">
        <small>
          {pending ? "Expires" : "Deadline"}{" "}
          <time dateTime={new Date(item.expiresAt).toISOString()}>
            {new Date(item.expiresAt).toLocaleTimeString()}
          </time>
          {item.decidedVia && ` · decided via ${item.decidedVia}`}
        </small>
        {pending && (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={decision.isPending || decision.isSuccess}
              onClick={() => decision.mutate("rejected")}
            >
              <X /> Reject
            </Button>
            <Button
              size="sm"
              disabled={decision.isPending || decision.isSuccess}
              onClick={() => decision.mutate("approved")}
            >
              <Check /> Approve
            </Button>
          </div>
        )}
      </div>
      {item.execution === "uncertain" && (
        <p role="alert">
          This action may have executed. Inspect the external service before
          requesting it again.
        </p>
      )}
      {decision.isError && (
        <p className="error" role="alert">
          {decision.error.message}
        </p>
      )}
      {decision.isSuccess && pending && (
        <small role="status">
          Decision saved: {decision.data.status}. Waiting for the live update…
        </small>
      )}
    </section>
  );
}
