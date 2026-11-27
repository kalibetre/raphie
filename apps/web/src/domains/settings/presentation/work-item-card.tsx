import type { WorkItem } from "@raphie/contracts";

import { Button } from "../../../shared/ui/button";
import type { WorkChange } from "../application/work-draft";

const statusLabel: Record<WorkItem["status"], string> = {
  active: "Active",
  waiting: "Waiting",
  done: "Done",
  dropped: "Dropped",
};

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Where an item is drawn on the Work page, so a link can bring it into view. */
export const workItemAnchor = (id: string) => `work-item-${id}`;

/** One work item: where it stands, the bot's notes, its latest result. */
export function WorkItemCard({
  item,
  bot,
  pending,
  onEdit,
  onChange,
  onCancel,
}: {
  item: WorkItem;
  /** The bot's name, for who opened or closed it. */
  bot: string;
  pending: boolean;
  onEdit: () => void;
  onChange: (change: WorkChange) => void;
  /** Stops its running background work. */
  onCancel: () => void;
}) {
  const open = item.status === "active" || item.status === "waiting";
  const running = !!item.run;
  // A scheduled job's item follows the job; it is changed there.
  const job = item.origin?.kind === "job";
  // A handoff's item reopens with its next request, not by hand.
  const handoff = !!item.origin?.kind.startsWith("handoff");
  const by = (actor: "bot" | "owner") => (actor === "bot" ? bot : "you");
  return (
    <article
      className="automation-job work-item"
      id={workItemAnchor(item.id)}
      aria-label={item.title}
    >
      <div className="automation-job-heading">
        <h3>{item.title}</h3>
        <span
          className={`session-status${item.status === "active" ? " working" : ""}`}
        >
          {running ? "Working" : statusLabel[item.status]}
        </span>
      </div>
      {item.status === "waiting" && item.waitingOn && (
        <p className="automation-note work-item-waiting">
          Waiting on {item.waitingOn}
        </p>
      )}
      {job && (
        <p className="automation-note">
          Scheduled job
          {item.nextAt ? ` · Next run ${when(item.nextAt)}` : ""} · Change it
          under Scheduled jobs.
        </p>
      )}
      {item.origin?.kind === "handoff-sent" && (
        <p className="automation-note">
          Handed to {item.origin.bot.name} · Its result comes back to the chat.
        </p>
      )}
      {item.origin?.kind === "handoff-received" && (
        <p className="automation-note">
          A task from {item.origin.bot.name} · The result goes back to it.
        </p>
      )}
      {item.notes && <p className="automation-prompt">{item.notes}</p>}
      {item.result && (
        <p className="automation-note">
          Latest: {item.result.text} · {when(item.result.at)}
        </p>
      )}
      <p className="automation-note">
        {item.id} · Opened by {by(item.opened.by)}, {when(item.opened.at)}
        {item.closed &&
          ` · ${item.status === "done" ? "Done" : "Dropped"} by ${by(item.closed.by)}, ${when(item.closed.at)}`}
      </p>
      {(running || (!job && (open || !handoff))) && (
        <div className="automation-actions">
          {running && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel run
            </Button>
          )}
          {job ? null : open ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onChange({ status: "done" })}
              >
                Mark done
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={onEdit}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onChange({ status: "dropped" })}
              >
                Drop
              </Button>
            </>
          ) : handoff ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onChange({ status: "active" })}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
