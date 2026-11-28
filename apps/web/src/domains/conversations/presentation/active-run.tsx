import type { SessionAsk, SessionCard } from "@raphie/contracts";
import { useEffect, useState } from "react";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import { ToolSteps } from "../../approvals/presentation/tool-steps";
import { useConnectionNames } from "../../settings/infrastructure/use-bot-automation";
import {
  activeRunLabel,
  formatDuration,
  type ToolStep,
} from "../application/run-projection";
import { toolDoing } from "../application/tool-phrases";
import { AskMarker } from "./ask-marker";
import { ShownCard } from "./shown-card";

export function ActiveRun({
  turn,
  state,
  steps,
  asks = [],
  cards = [],
  title,
}: {
  turn: Snapshot["turns"][number];
  state: Snapshot;
  steps: ToolStep[];
  /** Questions this turn asked the owner. */
  asks?: SessionAsk[];
  /** Cards this turn has shown so far. */
  cards?: SessionCard[];
  /** Who asks its questions: the bot's name. */
  title: string;
}) {
  const names = useConnectionNames();
  const [now, setNow] = useState(Date.now());
  const asking = asks.some((a) => a.status === "pending");
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
      {/* While it waits on a question the dock asks it: no spinner here. */}
      {asking ? (
        steps.length > 0 && (
          <ToolSteps steps={steps} working={false} decide={false} />
        )
      ) : (
        <ToolSteps
          steps={steps}
          working
          decide={false}
          activeLabel={activeRunLabel(
            state.live[turn.conversationId],
            steps,
            state.activity.filter((e) => e.runId === turn.id),
            (step) =>
              toolDoing(
                step,
                step.connection ? names.get(step.connection) : undefined,
              ),
          )}
          elapsed={formatDuration(now - turn.createdAt)}
        />
      )}
      {cards.map((shown) => (
        <ShownCard key={shown.id} shown={shown} />
      ))}
      {asks.map((ask) => (
        <AskMarker key={ask.id} ask={ask} title={title} />
      ))}
    </div>
  );
}
