import type { SessionAsk } from "@raphie/contracts";
import { useEffect, useState } from "react";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import { ToolSteps } from "../../approvals/presentation/tool-steps";
import {
  activeRunLabel,
  formatDuration,
  type ToolStep,
} from "../application/run-projection";
import { AskCard } from "./ask-card";

export function ActiveRun({
  turn,
  state,
  steps,
  asks = [],
}: {
  turn: Snapshot["turns"][number];
  state: Snapshot;
  steps: ToolStep[];
  /** Questions this turn asked the owner. */
  asks?: SessionAsk[];
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="active-run"
      role="status"
      aria-label="Current agent activity"
    >
      <ToolSteps
        steps={steps}
        working
        activeLabel={
          asks.some((a) => a.status === "pending")
            ? "Waiting for your answer…"
            : activeRunLabel(
                state.live[turn.conversationId],
                steps,
                state.activity.filter((e) => e.runId === turn.id),
              )
        }
        elapsed={formatDuration(now - turn.createdAt)}
      />
      {asks.map((ask) => (
        <AskCard key={ask.id} ask={ask} />
      ))}
    </div>
  );
}
