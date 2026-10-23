import type { SessionSummary } from "@raphie/contracts";
import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../../shared/ui/button";
import { ScrollArea } from "../../../../shared/ui/scroll-area";
import { SessionCard } from "./session-card";

export function ConversationLibrary({
  name,
  sessions,
  selectedId,
  unread,
  onSelect,
  onBack,
  hasMore,
  loadMore,
}: {
  name: string;
  sessions: SessionSummary[];
  selectedId?: string;
  unread: (session: SessionSummary) => number;
  onSelect: (id: string) => void;
  onBack: () => void;
  hasMore: boolean;
  loadMore: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"all" | "unread" | "approval">("all");
  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(filter.toLowerCase()) &&
      (tab !== "unread" || unread(s) > 0) &&
      (tab !== "approval" || s.waiting),
  );
  return (
    <ScrollArea
      className="conversation-library"
      viewportLabel="Conversation library"
    >
      <section className="library-page">
        <header className="library-heading">
          <div>
            <h2>Conversations</h2>
            <p>Your history with {name}.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onBack}>
            Back to chat
          </Button>
        </header>
        <div className="library-filters" aria-label="Filter conversations">
          {(
            [
              ["all", "All conversations"],
              ["unread", "New replies"],
              ["approval", "Needs approval"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={tab === id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="library-search">
          <Search size={15} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <nav
          className="conversation-list library-list"
          aria-label={`${name}’s conversations`}
        >
          {filtered.map((s) => (
            <div className="library-row" key={s.id}>
              <SessionCard
                session={s}
                selected={s.id === selectedId}
                now={Date.now()}
                onSelect={() => onSelect(s.id)}
              />
              {unread(s) > 0 && (
                <span className="library-unread">
                  {unread(s)} new {unread(s) === 1 ? "reply" : "replies"}
                </span>
              )}
            </div>
          ))}
        </nav>
        {!filtered.length && (
          <p className="sidebar-empty">
            {filter
              ? "No matching conversations."
              : tab === "all"
                ? "Your conversations will appear here."
                : "You’re all caught up."}
          </p>
        )}
        {hasMore && (
          <Button variant="outline" onClick={loadMore}>
            Load more conversations
          </Button>
        )}
      </section>
    </ScrollArea>
  );
}
