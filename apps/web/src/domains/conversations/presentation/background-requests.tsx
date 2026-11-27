import type { BackgroundRequest } from "@raphie/contracts";

import { ToolSteps } from "../../approvals/presentation/tool-steps";
import { AskCard } from "./ask-card";
import { WorkCard } from "./work-card";

/**
 * What the bot's background work waits on the owner for, shown at the end of
 * its chat: a card for each work item with its pending approvals and
 * questions, decided here without opening the item's session.
 */
export function BackgroundRequests({
  requests,
  onOpenItem,
}: {
  requests: BackgroundRequest[];
  onOpenItem?: (itemId: string) => void;
}) {
  if (!requests.length) return null;
  return (
    <section
      className="background-requests"
      aria-label="Background work needs you"
    >
      {requests.map((request) => (
        <WorkCard
          key={request.itemId}
          kind="background"
          title={request.title}
          itemId={request.itemId}
          status="needs-you"
          onOpenItem={onOpenItem && (() => onOpenItem(request.itemId))}
        >
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
        </WorkCard>
      ))}
    </section>
  );
}
