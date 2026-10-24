import { MessageCircle } from "lucide-react";

import { relativeTime } from "../../application/run-projection";
import {
  sessionPreview,
  type SessionSummary,
} from "../../application/session-summaries";

export function SessionCard({
  session,
  selected,
  now,
  onSelect,
  unreadCount,
}: {
  session: SessionSummary;
  selected: boolean;
  now: number;
  onSelect: () => void;
  unreadCount: number;
}) {
  const status = sessionStatus(session, unreadCount);
  const messages = `${session.turnCount} ${session.turnCount === 1 ? "message" : "messages"}`;
  return (
    <button
      className={`conversation-entry${selected ? " selected" : ""}`}
      data-unread={unreadCount > 0 || undefined}
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
    >
      <span className="conversation-row-top">
        {unreadCount > 0 && (
          <span className="conversation-dot" aria-hidden="true" />
        )}
        <span className="conversation-title">{session.title}</span>
        {session.origin === "discord" && (
          <MessageCircle
            size={11}
            aria-label="Discord session"
            className="conversation-origin"
          />
        )}
        <time
          dateTime={new Date(session.lastAt).toISOString()}
          title={new Date(session.lastAt).toLocaleString()}
        >
          {relativeTime(session.lastAt, now)}
        </time>
      </span>
      <span className="conversation-preview" title={messages}>
        {sessionPreview(session.preview)}
      </span>
      {status && (
        <span className={`conversation-status ${status.tone}`}>
          {status.label}
        </span>
      )}
    </button>
  );
}

/** One short status line per row, most urgent first; none when nothing needs saying. */
function sessionStatus(session: SessionSummary, unreadCount: number) {
  if (session.waiting)
    return { tone: "needs-approval", label: "Needs approval" };
  if (session.working) return { tone: "working", label: "Working…" };
  if (session.failed) return { tone: "failed", label: "Failed" };
  if (unreadCount > 0)
    return {
      tone: "unread",
      label: `${unreadCount} new ${unreadCount === 1 ? "reply" : "replies"}`,
    };
  return null;
}
