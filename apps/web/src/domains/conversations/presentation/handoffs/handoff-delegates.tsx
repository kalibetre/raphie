import type { Handoff } from "@raphie/contracts";
import { type CSSProperties, useState } from "react";

import { Button } from "../../../../shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../../shared/ui/popover";
import { BotAvatar } from "../../../settings/presentation/bot-avatar";
import { useBotStyle } from "../../../settings/presentation/bot-tones";
import {
  delegateGroups,
  delegateLabel,
  openHandoffs,
  statusLabel,
} from "../../application/handoffs";
import { handoffAnchor, useOpenSession } from "./handoff-cards";

const SHOWN = 3;

/**
 * Bots working for this session, in the composer: each avatar in an orbit of
 * its own colour while it works, amber when it waits for the owner. Stays in
 * view after the handoff's card has scrolled away.
 */
export function HandoffDelegates({
  sessionId,
  handoffs,
}: {
  sessionId?: string;
  handoffs: readonly Handoff[];
}) {
  const [open, setOpen] = useState(false);
  const openSession = useOpenSession();
  const botStyle = useBotStyle();
  const groups = delegateGroups(openHandoffs(handoffs, sessionId));
  if (!groups.length) return null;
  const waiting = groups.some((group) => group.waiting);
  const label = delegateLabel(groups);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="handoff-delegates"
            data-waiting={waiting || undefined}
            aria-label={`Handed-off tasks: ${label}`}
          />
        }
      >
        <span className="handoff-orbits">
          {groups.slice(0, SHOWN).map((group, index) => (
            <span
              key={group.bot.id}
              className="handoff-orbit"
              data-waiting={group.waiting || undefined}
              style={
                {
                  ...botStyle(group.bot.id),
                  "--orbit-delay": `${-index * 0.8}s`,
                } as CSSProperties
              }
            >
              <BotAvatar id={group.bot.id} />
            </span>
          ))}
          {groups.length > SHOWN && (
            <span className="handoff-orbit-more">+{groups.length - SHOWN}</span>
          )}
        </span>
        <span className="handoff-delegates-label">{label}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="handoff-popover"
        aria-label="Handed-off tasks"
      >
        <p className="handoff-popover-title">
          Handed off from this conversation
        </p>
        {groups.map((group) => (
          <section key={group.bot.id} className="handoff-popover-group">
            <h3>
              <BotAvatar id={group.bot.id} />
              {group.bot.name}
              <small>
                {group.handoffs.length}{" "}
                {group.handoffs.length === 1 ? "task" : "tasks"}
              </small>
            </h3>
            {group.handoffs.map((handoff) => (
              <div key={handoff.id} className="handoff-popover-row">
                <button
                  type="button"
                  className="handoff-popover-task"
                  title="Show the handoff in this conversation"
                  onClick={() => {
                    setOpen(false);
                    const last = handoff.requests.length - 1;
                    document
                      .getElementById(handoffAnchor(handoff.id, last))
                      ?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                >
                  {handoff.title}
                </button>
                <span
                  className="handoff-status"
                  data-status={handoff.waiting ? "waiting" : "working"}
                >
                  <span className="handoff-status-dot" aria-hidden="true" />
                  {handoff.waiting ? "Needs you" : statusLabel.working}
                </span>
                {handoff.waiting && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpen(false);
                      void openSession(handoff.to.id, handoff.toSessionId);
                    }}
                  >
                    Review
                  </Button>
                )}
              </div>
            ))}
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Above the composer in a task another bot handed off: the owner can continue
 * it here, while that bot's own requests still report back to it.
 */
export function HandoffNote({ from }: { from: { id: string; name: string } }) {
  const openSession = useOpenSession();
  return (
    <div className="handoff-note" role="note">
      <BotAvatar id={from.id} />
      <p>
        <strong>{from.name}</strong> handed off this task and gets the results
        of its requests. What you write here stays here.
      </p>
      <Button
        size="xs"
        variant="ghost"
        type="button"
        onClick={() => void openSession(from.id)}
      >
        Open {from.name}
      </Button>
    </div>
  );
}
