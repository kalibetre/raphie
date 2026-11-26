import type { WorkItem } from "@raphie/contracts";

import { Button } from "../../../shared/ui/button";
import type { WorkChange } from "../infrastructure/use-work-items";

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

/** One work item: where it stands, the bot's notes, its latest result. */
export function WorkItemCard({
  item,
  bot,
  pending,
  onEdit,
  onChange,
}: {
  item: WorkItem;
  /** The bot's name, for who opened or closed it. */
  bot: string;
  pending: boolean;
  onEdit: () => void;
  onChange: (change: WorkChange) => void;
}) {
  const open = item.status === "active" || item.status === "waiting";
  const by = (actor: "bot" | "owner") => (actor === "bot" ? bot : "you");
  return (
    <article className="automation-job work-item" aria-label={item.title}>
      <div className="automation-job-heading">
        <h3>{item.title}</h3>
        <span
          className={`session-status${item.status === "active" ? " working" : ""}`}
        >
          {statusLabel[item.status]}
        </span>
      </div>
      {item.status === "waiting" && item.waitingOn && (
        <p className="automation-note work-item-waiting">
          Waiting on {item.waitingOn}
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
      <div className="automation-actions">
        {open ? (
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
        ) : (
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
    </article>
  );
}
