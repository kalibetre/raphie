import { Button } from "../../../shared/ui/button";
import { jobRunDescription, jobRunStatus } from "../application/job-run-status";
import { useJobRuns } from "../infrastructure/use-job-runs";
import { Group } from "./settings-group";

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
    <Group
      title="Run history"
      note="Actual reply outcomes, including runs from removed jobs. Active and unread runs remain visible; the newest 500 acknowledged runs per bot are retained."
    >
      <div className="automation-job" id="job-run-history">
        {jobId && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Show all jobs
          </Button>
        )}
        {history.isPending ? (
          <p role="status">Loading run history…</p>
        ) : history.error ? (
          <p role="alert">
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
      </div>
      {runs.map((run) => (
        <article className="automation-job" key={run.id}>
          <div className="automation-job-heading">
            <h3>{run.name}</h3>
            <span className="session-status">{jobRunStatus[run.status]}</span>
          </div>
          <p className="automation-note">
            Started {new Date(run.startedAt).toLocaleString()}
            {run.finishedAt
              ? ` · Finished ${new Date(run.finishedAt).toLocaleString()}`
              : ""}
          </p>
          <p className="automation-note">{jobRunDescription(run)}</p>
          {run.sessionId && (
            <div className="automation-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpen(run.sessionId!)}
              >
                Open run conversation
              </Button>
            </div>
          )}
        </article>
      ))}
      {history.hasNextPage && (
        <div className="automation-job">
          <Button
            variant="outline"
            size="sm"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage ? "Loading…" : "Load older runs"}
          </Button>
        </div>
      )}
    </Group>
  );
}
