import { ArrowUpRight, CalendarClock } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import { jobRunDescription, jobRunStatus } from "../application/job-run-status";
import { useJobRuns } from "../infrastructure/use-job-runs";

export function JobRunHistory({
  jobId,
  onClear,
  onOpen,
}: {
  jobId?: string;
  onClear: () => void;
  onOpen: (sessionId: string) => void;
}) {
  const history = useJobRuns(jobId);
  const runs = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="settings-group job-history" id="job-run-history">
      <div className="settings-group-heading">
        <div>
          <h2>Run history</h2>
          <p>Recent results, including runs from removed jobs.</p>
        </div>
        {jobId && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Show all jobs
          </Button>
        )}
      </div>
      {history.isPending ? (
        <p role="status" className="automation-note">
          Loading run history…
        </p>
      ) : history.error ? (
        <p role="alert" className="automation-note">
          Could not refresh run history.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void history.refetch()}
          >
            Retry
          </Button>
        </p>
      ) : !runs.length ? (
        <p className="automation-note">
          No tracked runs yet. Earlier submissions do not have completion
          history.
        </p>
      ) : null}
      <div className="job-history-list">
        {runs.map((run) => {
          const content = (
            <>
              <span className="job-history-icon">
                <CalendarClock size={16} />
              </span>
              <span className="job-history-copy">
                <span className="job-history-meta">
                  <strong>{run.name}</strong>
                  <time dateTime={new Date(run.startedAt).toISOString()}>
                    {new Date(run.startedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </span>
                <span className="job-history-status">
                  {jobRunStatus[run.status]}
                </span>
                <span className="job-history-description">
                  {jobRunDescription(run)}
                </span>
              </span>
              {run.sessionId && (
                <ArrowUpRight size={15} className="job-history-arrow" />
              )}
            </>
          );
          return (
            <article key={run.id} className="job-history-row">
              {run.sessionId ? (
                <button
                  className="job-history-target"
                  onClick={() => onOpen(run.sessionId!)}
                  aria-label={`${run.name}, ${jobRunStatus[run.status]}, open run conversation`}
                >
                  {content}
                </button>
              ) : (
                <div className="job-history-target">{content}</div>
              )}
            </article>
          );
        })}
      </div>
      {history.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Load older runs"}
        </Button>
      )}
    </section>
  );
}
