import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarClock, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

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
  const client = useQueryClient();
  const runs = history.runs;
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
    history;
  useEffect(() => {
    const target = sentinel.current;
    if (
      !target ||
      !hasNextPage ||
      isFetching ||
      isFetchNextPageError ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, jobId]);
  return (
    <section className="settings-group job-history" id="job-run-history">
      <div className="settings-group-heading">
        <div>
          <h2>Run history</h2>
          <p>Recent results, including runs from removed jobs.</p>
        </div>
        <div className="automation-actions">
          {jobId && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Show all jobs
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh run history"
            title="Refresh run history"
            disabled={history.isFetching}
            onClick={() => {
              document
                .getElementById("job-run-history")
                ?.scrollIntoView({ block: "start" });
              void client.resetQueries({
                queryKey: ["job-runs", jobId ?? "all"],
                exact: true,
              });
            }}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>
      {history.isPending ? (
        <p role="status" className="automation-note">
          Loading run history…
        </p>
      ) : history.error && !history.data ? (
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
      {history.latestError && (
        <p role="alert" className="automation-note">
          Could not refresh the latest runs.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void history.refetchLatest()}
          >
            Retry
          </Button>
        </p>
      )}
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
        <div ref={sentinel} className="job-history-more">
          {history.isFetchingNextPage ? (
            <p role="status" className="automation-note">
              Loading older runs…
            </p>
          ) : (
            <>
              {history.isFetchNextPageError && (
                <p role="alert" className="automation-note">
                  Could not load older runs.
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchNextPageError
                  ? "Retry loading older runs"
                  : "Load older runs"}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
