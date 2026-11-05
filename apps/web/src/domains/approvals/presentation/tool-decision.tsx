import { useMutation } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { type Approval } from "../../../infrastructure/http/api-client";
import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";

export function ToolDecision({ approval }: { approval: Approval }) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const decision = useMutation({
    mutationFn: (value: {
      decision: "approved" | "rejected";
      scope: "once" | "session";
    }) =>
      api<{ status: string }>(`/api/tool-approvals/${approval.id}`, {
        ...value,
      }),
  });
  const busy = decision.isPending || decision.isSuccess;
  return (
    <div className="decision">
      <small>
        Expires{" "}
        <time dateTime={new Date(approval.expiresAt).toISOString()}>
          {new Date(approval.expiresAt).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </small>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => decision.mutate({ decision: "rejected", scope: "once" })}
      >
        <X /> Reject
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => decision.mutate({ decision: "approved", scope: "once" })}
      >
        <Check /> Approve once
      </Button>
      {approval.server === "workspace" &&
        approval.connectionIdentity === "raphie.workspace.command" &&
        (approval.tool === "bash" || approval.tool === "workspace_exec") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={`Allow these exact arguments for ${approval.tool} in this bot conversation: ${approval.argumentsJson}`}
            onClick={() =>
              decision.mutate({ decision: "approved", scope: "session" })
            }
          >
            Approve for session
          </Button>
        )}
      {decision.isError && (
        <p className="error" role="alert">
          {decision.error.message}
        </p>
      )}
    </div>
  );
}
