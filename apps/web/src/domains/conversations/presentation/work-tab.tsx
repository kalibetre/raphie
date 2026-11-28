import type { SessionTurn } from "@raphie/contracts";
import { SquareArrowOutUpRight } from "lucide-react";

const stamp = {
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

/**
 * Where a bot's message came from, under its name: the work item, the owner's
 * request that started it (a scheduled job answers no one, so it says
 * "scheduled"), and, once the message is finished, a stamp with how the run
 * ended. With `onOpen` the tab is a link to its item on the Work page.
 */
export function WorkTab({
  turn,
  onOpen,
}: {
  turn: SessionTurn;
  onOpen?: () => void;
}) {
  const work = turn.work;
  const title = turn.scheduled?.name ?? work?.title ?? "Work";
  const reminder = work?.kind === "reminder";
  // Only a finished message has an outcome to stamp.
  const outcome =
    !reminder && turn.status === "done"
      ? (work?.outcome ?? "completed")
      : undefined;
  const from = work?.request
    ? `“${work.request}”`
    : turn.scheduled
      ? "scheduled"
      : undefined;
  const content = (
    <>
      <span className="work-tab-text">
        <span aria-hidden="true">↳ </span>
        <strong className="work-tab-title">
          {reminder ? "Open work item" : title}
        </strong>
        {from && ` · ${from}`}
      </span>
      {outcome && (
        <span className="work-tab-stamp">
          <span className="sr-only">Run </span>
          {stamp[outcome]}
        </span>
      )}
    </>
  );
  const tip = [work?.itemId, title, from].filter(Boolean).join(" · ");
  return onOpen && work ? (
    <button
      type="button"
      className="work-tab work-tab-link"
      data-outcome={outcome}
      title={`Open ${tip}`}
      aria-label={reminder ? `Open ${title}` : undefined}
      onClick={onOpen}
    >
      {content}
      <SquareArrowOutUpRight
        className="work-tab-open"
        size={12}
        aria-hidden="true"
      />
    </button>
  ) : (
    <p className="work-tab" data-outcome={outcome} title={tip}>
      {content}
    </p>
  );
}
