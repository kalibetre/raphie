import type { BackgroundRequest } from "@raphie/contracts";

import { AskMarker } from "./ask-marker";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * What the bot's background work waits on the owner for, marked at the end
 * of its chat: one line for each question or approval. The dock on the
 * composer asks them.
 */
export function BackgroundMarkers({
  requests,
}: {
  requests: BackgroundRequest[];
}) {
  const waiting = requests.some(
    (r) =>
      r.asks.some((a) => a.status === "pending") ||
      r.toolApprovals.some(
        (a) => a.status === "pending" && a.expiresAt > Date.now(),
      ),
  );
  if (!waiting) return null;
  return (
    <section
      className="background-requests"
      aria-label="Background work needs you"
    >
      {requests.flatMap((request) => [
        // Settled ones are receipts, placed in the chat where they were
        // settled.
        ...request.asks
          .filter((ask) => ask.status === "pending")
          .map((ask) => (
            <AskMarker key={ask.id} ask={ask} title={request.title} />
          )),
        ...request.toolApprovals
          .filter((a) => a.status === "pending" && a.expiresAt > Date.now())
          .map((approval) => (
            <p key={approval.id} className="ask-marker">
              <span className="ask-marker-dot" aria-hidden="true" />
              <span>
                {request.title} needs approval to run{" "}
                <code>{approval.tool}</code> ·{" "}
                <time dateTime={new Date(approval.createdAt).toISOString()}>
                  {time(approval.createdAt)}
                </time>
              </span>
            </p>
          )),
      ])}
    </section>
  );
}
