import type { Page, ScheduledJobRun, SessionSummary } from "@raphie/contracts";
import { useMutation, useQueries } from "@tanstack/react-query";
import { Bell, MessageSquareText, ShieldQuestion, X } from "lucide-react";
import { useState } from "react";

import { sessionPreview } from "../../domains/conversations/application/session-summaries";
import { jobRunStatus } from "../../domains/settings/application/job-run-status";
import { useBackend } from "../../infrastructure/http/backend-context";
import { Button } from "../../shared/ui/button";

export type NotificationBot = { id: string; name: string };

export function useJobNotifications(bots: NotificationBot[]) {
  const { backend } = useBackend();
  const queries = useQueries(
    {
      queries: bots.map((bot) => ({
        queryKey: ["job-notifications", bot.id],
        queryFn: () =>
          backend.api<Page<ScheduledJobRun> & { total: number }>(
            `/api/bots/${encodeURIComponent(bot.id)}/jobs/notifications`,
          ),
        refetchInterval: 15000,
      })),
    },
    backend.queries,
  );
  return {
    count: queries.reduce(
      (sum, query) =>
        sum + (query.data?.total ?? query.data?.items.length ?? 0),
      0,
    ),
    entries: bots.flatMap((bot, i) =>
      (queries[i]?.data?.items ?? []).map((run) => ({ bot, run })),
    ),
    queries,
  };
}

export function Notifications({
  bots,
  byBot,
  unread,
  jobs,
  onOpen,
}: {
  bots: NotificationBot[];
  byBot: Map<string, SessionSummary[]>;
  unread: (botId: string, session: SessionSummary) => number;
  jobs: ReturnType<typeof useJobNotifications>;
  onOpen: (botId: string, sessionId: string) => void;
}) {
  const { backend } = useBackend();
  const [error, setError] = useState(false);
  const acknowledge = useMutation({
    mutationFn: ({ botId, id }: { botId: string; id: string }) =>
      backend.api(
        `/api/bots/${encodeURIComponent(botId)}/jobs/runs/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      ),
    onSuccess: (_result, { botId }) => {
      setError(false);
      void backend.queries.invalidateQueries({
        queryKey: ["job-notifications", botId],
      });
    },
    onError: () => setError(true),
  });
  const conversations = bots.flatMap((bot) =>
    (byBot.get(bot.id) ?? [])
      .filter((session) => session.waiting || unread(bot.id, session) > 0)
      .map((session) => ({ bot, session })),
  );
  const failed = jobs.queries.some((query) => query.isError);
  const loading = jobs.queries.some((query) => query.isPending);
  return (
    <div className="notifications-page">
      <div className="notifications-heading">
        <h2>Notifications</h2>
        <p>Replies, approvals, and job results across your bots.</p>
      </div>
      {error && (
        <p role="alert">Couldn’t dismiss the update. Please try again.</p>
      )}
      {failed && (
        <p role="alert">
          Some job updates couldn’t be loaded.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              jobs.queries.forEach((query) => void query.refetch())
            }
          >
            Retry
          </Button>
        </p>
      )}
      {!conversations.length && !jobs.entries.length && !loading && !failed && (
        <p className="notifications-empty">You’re all caught up.</p>
      )}
      <div className="notifications-list">
        {conversations.map(({ bot, session }) => (
          <article
            className="notifications-row"
            key={`${bot.id}:${session.id}`}
          >
            <button
              className="notifications-target"
              onClick={() => onOpen(bot.id, session.sessionId)}
            >
              {session.waiting ? (
                <ShieldQuestion size={18} />
              ) : (
                <MessageSquareText size={18} />
              )}
              <span>
                <strong>{session.title}</strong>
                <small>
                  {bot.name} ·{" "}
                  {session.waiting
                    ? "Needs approval"
                    : `${unread(bot.id, session)} new ${unread(bot.id, session) === 1 ? "reply" : "replies"}`}
                </small>
                <small>
                  {session.waiting
                    ? "A tool action needs your review."
                    : sessionPreview(session.replyPreview || session.preview)}
                </small>
              </span>
            </button>
          </article>
        ))}
        {jobs.entries.map(({ bot, run }) => (
          <article className="notifications-row" key={`${bot.id}:${run.id}`}>
            <div className="notifications-target">
              <Bell size={18} />
              <span>
                <strong>{run.name}</strong>
                <small>
                  {bot.name} · {jobRunStatus[run.status]}
                </small>
                {run.sessionId && (
                  <button
                    className="notifications-open"
                    onClick={() => {
                      acknowledge.mutate({ botId: bot.id, id: run.id });
                      onOpen(bot.id, run.sessionId!);
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
              aria-label={`Dismiss update for ${run.name}`}
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ botId: bot.id, id: run.id })}
            >
              <X size={15} />
            </Button>
          </article>
        ))}
      </div>
      {jobs.queries.some((query) => query.data?.next) && (
        <p>
          Showing the latest job updates for each bot. Dismiss updates to see
          older ones.
        </p>
      )}
    </div>
  );
}
