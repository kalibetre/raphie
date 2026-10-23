import type { SessionSummary } from "@raphie/contracts";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../../infrastructure/preferences/storage";
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
          <span>
            <i />
            {visible.length}{" "}
            {visible.length === 1 ? "conversation" : "conversations"} with
            updates
          </span>
          <span>
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
              </button>
              <button
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
              </button>
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
