import type { SessionSummary } from "@raphie/contracts";
import {
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../../infrastructure/preferences/storage";
import { Button } from "../../../../shared/ui/button";
import { sessionPreview } from "../../application/session-summaries";

export function ReplyCard({
  sessions,
  unread,
  onSelect,
  storageKey,
  onViewAll,
}: {
  sessions: SessionSummary[];
  unread: (session: SessionSummary) => number;
  onSelect: (id: string) => void;
  storageKey: string;
  onViewAll: () => void;
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  useEffect(() => {
    const saved = readLocal(storageKey);
    setCollapsed(
      saved === null
        ? window.matchMedia("(max-width: 767px)").matches
        : saved === "true",
    );
  }, [storageKey]);
  const visible = sessions.filter(
    (s) => dismissed[s.id] !== `${s.replyCount}:${s.waiting}`,
  );
  if (!visible.length) return null;
  return (
    <section
      className="reply-card-area"
      aria-label="Activity in other conversations"
    >
      <div className="reply-card-inner">
        <button
          className="reply-card-heading"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={() => {
            setCollapsed(!collapsed);
            writeLocal(storageKey, String(!collapsed));
          }}
        >
          <span className="reply-card-heading-label">
            <MessageSquareText size={15} aria-hidden="true" />
            {visible.length}{" "}
            {visible.length === 1 ? "conversation" : "conversations"} with
            updates
          </span>
          <span className="reply-card-toggle">
            {collapsed ? "Show replies" : "Hide replies"}
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </span>
        </button>
        <div id={id} className="reply-card-list" hidden={collapsed}>
          {visible.slice(0, 3).map((s) => (
            <div className="reply-card-row" key={s.id}>
              <button
                className="reply-card-target"
                onClick={() => onSelect(s.id)}
              >
                <span
                  className="reply-card-symbol"
                  data-approval={s.waiting || undefined}
                >
                  {s.waiting ? (
                    <ShieldQuestion size={16} />
                  ) : (
                    <MessageSquareText size={16} />
                  )}
                </span>
                <span className="reply-card-copy">
                  <span className="reply-card-title">
                    <span className="reply-card-name">{s.title}</span>
                    <span
                      className={s.waiting ? "reply-approval" : "reply-count"}
                    >
                      {s.waiting ? "Needs approval" : `${unread(s)} new`}
                    </span>
                  </span>
                  <span className="reply-card-preview">
                    {s.waiting
                      ? "A tool action needs your review."
                      : sessionPreview(s.replyPreview || s.preview)}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="reply-card-dismiss"
                aria-label={`Dismiss notification for ${s.title}`}
                onClick={() =>
                  setDismissed((current) => ({
                    ...current,
                    [s.id]: `${s.replyCount}:${s.waiting}`,
                  }))
                }
              >
                <X size={13} />
              </Button>
            </div>
          ))}
          {visible.length > 3 && (
            <button className="reply-card-more" onClick={onViewAll}>
              View all {visible.length} conversations
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
