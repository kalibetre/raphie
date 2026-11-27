import type { SessionTurn } from "@raphie/contracts";

const stamp = {
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

/**
 * Where a bot's message came from, under its name: the work item, the owner's
 * request that started it (a scheduled job answers no one, so it says
 * "scheduled"), and, once the message is finished, a stamp with how the run
 * ended.
 */
export function WorkTab({ turn }: { turn: SessionTurn }) {
  const work = turn.work;
  const title = turn.scheduled?.name ?? work?.title ?? "Work";
  // Only a finished message has an outcome to stamp.
  const outcome =
    turn.status === "done" ? (work?.outcome ?? "completed") : undefined;
  const from = work?.request
    ? `“${work.request}”`
    : turn.scheduled
      ? "scheduled"
      : undefined;
  return (
    <p className="work-tab" data-outcome={outcome}>
      <span
        className="work-tab-text"
        title={from ? `${title} · ${from}` : title}
      >
        <span aria-hidden="true">↳ </span>
        <strong className="work-tab-title">{title}</strong>
        {from && ` · ${from}`}
      </span>
      {outcome && (
        <span className="work-tab-stamp">
          <span className="sr-only">Run </span>
          {stamp[outcome]}
        </span>
      )}
    </p>
  );
}
