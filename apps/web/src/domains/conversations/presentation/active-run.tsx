import { useEffect, useState } from "react";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import { ToolSteps } from "../../approvals/presentation/tool-steps";
import {
  activeRunLabel,
  formatDuration,
  type ToolStep,
} from "../application/run-projection";

export function ActiveRun({
  turn,
  state,
  steps,
}: {
  turn: Snapshot["turns"][number];
  state: Snapshot;
  steps: ToolStep[];
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
        activeLabel={activeRunLabel(
          state.live[turn.conversationId],
          steps,
          state.activity.filter((e) => e.runId === turn.id),
        )}
        elapsed={formatDuration(now - turn.createdAt)}
      />
    </div>
  );
}
