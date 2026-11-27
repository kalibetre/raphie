import type { SessionTurn } from "@raphie/contracts";

const stamp = {
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

/**
 * Where a bot's message came from, under its name: the work item, the owner's
 * request that started it (a scheduled job answers no one, so it says
 * "scheduled"), and a stamp with how the run ended.
 */
export function WorkTab({ turn }: { turn: SessionTurn }) {
  const work = turn.work;
  const title = turn.scheduled?.name ?? work?.title ?? "Work";
  const outcome = work?.outcome ?? "completed";
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
        <strong>{title}</strong>
        {from && ` · ${from}`}
      </span>
      <span className="work-tab-stamp">{stamp[outcome]}</span>
    </p>
  );
}
