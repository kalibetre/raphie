import {
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  ShieldQuestion,
} from "lucide-react";

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
}: {
  session: SessionSummary;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  return (
    <button
      className={selected ? "selected" : ""}
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
    >
      <span className="conversation-card-heading">
        <span className="conversation-title">{session.title}</span>
        <time
          dateTime={new Date(session.lastAt).toISOString()}
          title={new Date(session.lastAt).toLocaleString()}
        >
          {relativeTime(session.lastAt, now)}
        </time>
      </span>
      <span className="conversation-preview">
        {sessionPreview(session.preview)}
      </span>
      <span className="conversation-card-footer">
        <SessionBadge session={session} />
        <span className="conversation-meta">
          {session.origin === "discord" && (
            <MessageCircle size={12} aria-label="Discord session" />
          )}
          {session.turnCount} {session.turnCount === 1 ? "message" : "messages"}
        </span>
      </span>
    </button>
  );
}

function SessionBadge({ session }: { session: SessionSummary }) {
  if (session.waiting)
    return (
      <span className="session-status needs-approval">
        <ShieldQuestion size={12} />
        Approval
      </span>
    );
  if (session.working)
    return (
      <span className="session-status working">
        <LoaderCircle size={12} className="spin" />
        Working
      </span>
    );
  if (session.failed)
    return (
      <span className="session-status failed">
        <CircleAlert size={12} />
        Error
      </span>
    );
  return null;
}
