import type { Page, ScheduledJobRun } from "@raphie/contracts";
import { useMutation, useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

import { sessionPreview } from "../../domains/conversations/application/session-summaries";
import { jobRunStatus } from "../../domains/settings/application/job-run-status";
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { useBackend } from "../../infrastructure/http/backend-context";
import { Button } from "../../shared/ui/button";
import type { NotificationBot, NotificationItem } from "./notification-items";

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
  items,
  jobs,
  count,
  onOpen,
}: {
  items: NotificationItem[];
  jobs: ReturnType<typeof useJobNotifications>;
  count: number;
  onOpen: (botId: string, sessionId: string) => void;
}) {
  const { backend } = useBackend();
  const [filter, setFilter] = useState<"all" | NotificationItem["kind"]>("all");
  const [error, setError] = useState(false);
  const acknowledge = useMutation({
    mutationFn: ({ botId, id }: { botId: string; id: string }) =>
      backend.api(
        `/api/bots/${encodeURIComponent(botId)}/jobs/runs/${encodeURIComponent(id)}/read`,
        {},
      ),
    onSuccess: (_result, { botId }) => {
      setError(false);
      void backend.queries.invalidateQueries({
        queryKey: ["job-notifications", botId],
      });
    },
    onError: () => setError(true),
  });
  const failed = jobs.queries.some((query) => query.isError);
  const loading = jobs.queries.some((query) => query.isPending);
  const visible = items.filter(
    (item) =>
      filter === "all" ||
      item.kind === filter ||
      (filter === "reply" && item.kind === "job" && !!item.session),
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = [
    {
      label: "Today",
      items: visible.filter((item) => item.time >= today.getTime()),
    },
    {
      label: "Earlier",
      items: visible.filter((item) => item.time < today.getTime()),
    },
  ];

  function open(item: NotificationItem) {
    if (!item.run?.sessionId && !item.session) return;
    if (item.run) acknowledge.mutate({ botId: item.bot.id, id: item.run.id });
    onOpen(item.bot.id, item.run?.sessionId ?? item.session!.sessionId);
  }

  return (
    <div className="notifications-page">
      <div className="notifications-heading">
        <h2>
          Notifications <span>{count ? `${count} new` : ""}</span>
        </h2>
      </div>
      <div
        className="notifications-tabs"
        role="group"
        aria-label="Filter notifications"
      >
        {(
          [
            ["all", "All"],
            ["reply", "Replies"],
            ["approval", "Approvals"],
            ["job", "Jobs"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
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
      {!visible.length && !loading && !failed && (
        <p className="notifications-empty">
          {filter === "all"
            ? "You’re all caught up."
            : "No updates in this view."}
        </p>
      )}
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.label} aria-label={group.label}>
              <h3 className="notifications-group">{group.label}</h3>
              {group.items.map((item) => {
                const canOpen = !!(item.session || item.run?.sessionId);
                const title =
                  item.kind === "approval"
                    ? "Needs your approval"
                    : item.kind === "reply"
                      ? `${item.unread} new ${item.unread === 1 ? "reply" : "replies"}`
                      : item.run!.status === "completed"
                        ? "Your scheduled reply is ready"
                        : `Scheduled job ${jobRunStatus[item.run!.status].toLowerCase()}`;
                const preview =
                  item.kind === "approval"
                    ? "Review the proposed action before continuing."
                    : item.session
                      ? sessionPreview(
                          item.session.replyPreview || item.session.preview,
                        )
                      : "";
                const body = (
                  <>
                    <span className="notifications-avatar">
                      <BotAvatar id={item.bot.id} />
                    </span>
                    <span className="notifications-copy">
                      <span className="notifications-meta">
                        <strong>{item.bot.name}</strong>
                        <span>· {item.run?.name ?? item.session?.title}</span>
                        <time dateTime={new Date(item.time).toISOString()}>
                          {new Date(item.time).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </span>
                      <span className="notifications-title">
                        {title}
                        {item.kind !== "reply" && (
                          <span className="notifications-tag">
                            {item.kind === "approval"
                              ? "Action required"
                              : `Job ${jobRunStatus[item.run!.status].toLowerCase()}`}
                          </span>
                        )}
                      </span>
                      {preview && (
                        <span className="notifications-preview">{preview}</span>
                      )}
                    </span>
                    <span className="notifications-dot" aria-hidden="true" />
                  </>
                );
                return (
                  <article className="notifications-row" key={item.key}>
                    {canOpen ? (
                      <button
                        className="notifications-target"
                        onClick={() => open(item)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="notifications-target">{body}</div>
                    )}
                    {item.run && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Dismiss update for ${item.run.name}`}
                        disabled={acknowledge.isPending}
                        onClick={() =>
                          acknowledge.mutate({
                            botId: item.bot.id,
                            id: item.run!.id,
                          })
                        }
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </article>
                );
              })}
            </section>
          ),
      )}
      {jobs.queries.some((query) => query.data?.next) && (
        <p>
          Showing the latest job updates for each bot. Dismiss updates to see
          older ones.
        </p>
      )}
      <p className="notifications-hint">
        Select an update to open its conversation. Approvals stay here until you
        decide.
      </p>
    </div>
  );
}
