import type { BackgroundRequest } from "@raphie/contracts";
import { ListChecks } from "lucide-react";

import { ToolSteps } from "../../approvals/presentation/tool-steps";
import { AskCard } from "./ask-card";

/**
 * What the bot's background work waits on the owner for, shown at the end of
 * its chat: each work item's pending approvals and questions, decided here
 * without opening the item's session.
 */
export function BackgroundRequests({
  requests,
}: {
  requests: BackgroundRequest[];
}) {
  if (!requests.length) return null;
  return (
    <section
      className="background-requests"
      aria-label="Background work needs you"
    >
      {requests.map((request) => (
        <div key={request.itemId} className="background-request">
          <p className="turn-scheduled" title={`Work item ${request.itemId}`}>
            <ListChecks size={13} aria-hidden="true" />
            <span>
              Background work · <strong>{request.title}</strong> needs you
            </span>
          </p>
          {request.toolApprovals.length > 0 && (
            <ToolSteps
              working
              steps={request.toolApprovals.map((approval) => ({
                id: approval.id,
                server: approval.server,
                tool: approval.tool,
                startedAt: approval.createdAt,
                approval,
              }))}
            />
          )}
          {request.asks.map((ask) => (
            <AskCard key={ask.id} ask={ask} />
          ))}
        </div>
      ))}
    </section>
  );
}
