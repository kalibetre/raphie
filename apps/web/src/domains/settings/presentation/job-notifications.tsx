import type { Page, ScheduledJobRun } from "@raphie/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { jobRunStatus } from "../application/job-run-status";

export function JobNotifications({
  onOpen,
}: {
  onOpen: (sessionId: string) => void;
}) {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const [error, setError] = useState(false);
  const notifications = useInfiniteQuery({
    queryKey: ["job-notifications"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      workspace.api<Page<ScheduledJobRun>>(
        `/api/jobs/notifications${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (page) => page.next,
    refetchInterval: 5000,
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      workspace.api(`/api/jobs/runs/${encodeURIComponent(id)}/read`, {
        method: "POST",
      }),
    onSuccess: () => {
      setError(false);
      void client.invalidateQueries({ queryKey: ["job-notifications"] });
      void client.invalidateQueries({ queryKey: ["job-runs"] });
    },
    onError: () => setError(true),
  });
  const runs = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  if (!runs.length && !error) return null;
  return (
    <section className="reply-card-area" aria-label="Job updates">
      <div className="reply-card-inner">
        <div className="reply-card-heading">
          <span className="reply-card-heading-label">
            <Bell size={15} aria-hidden="true" /> Job updates
          </span>
        </div>
        {error && (
          <p role="alert">Could not dismiss the update. Please try again.</p>
        )}
        <div className="reply-card-list">
          {runs.map((run) => (
            <div className="reply-card-row" key={run.id}>
              <div className="reply-card-target">
                <span className="reply-card-copy">
                  <span className="reply-card-title">
                    <span className="reply-card-name">{run.name}</span>
                    <span className="reply-count">
                      {jobRunStatus[run.status]}
                    </span>
                  </span>
                  {run.sessionId && (
                    <button
                      className="reply-card-preview"
                      onClick={() => {
                        onOpen(run.sessionId!);
                        acknowledge.mutate(run.id);
                      }}
                    >
                      Open conversation
                    </button>
                  )}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="reply-card-dismiss"
                aria-label={`Dismiss update for ${run.name}`}
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(run.id)}
              >
                <X size={13} />
              </Button>
            </div>
          ))}
          {notifications.hasNextPage && (
            <button
              className="reply-card-more"
              disabled={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              Load more updates
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
