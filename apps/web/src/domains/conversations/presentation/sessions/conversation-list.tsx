import type { SessionSummary } from "@raphie/contracts";
import { Archive, MessageSquareText, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../../../shared/ui/button";
import { ScrollArea } from "../../../../shared/ui/scroll-area";
import {
  byNewReplies,
  titleMatches,
} from "../../application/session-summaries";
import { SessionCard } from "./session-card";

/**
 * Searchable list of one bot's conversations. Those with new replies come
 * first, then the rest; each group most recent first. Archived ones are in
 * Settings, not here.
 */
export function ConversationList({
  name,
  sessions,
  selectedId,
  unread,
  onSelect,
  hasMore,
  loadMore,
  onArchive,
}: {
  name: string;
  sessions: SessionSummary[];
  selectedId?: string;
  unread: (session: SessionSummary) => number;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadMore: () => void;
  onArchive: (session: SessionSummary) => void;
}) {
  const [filter, setFilter] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    setFilter("");
    searchInput.current?.focus();
  };
  const [tab, setTab] = useState<"all" | "approval">("all");
  const counts = {
    all: sessions.length,
    approval: sessions.filter((s) => s.waiting).length,
  };
  const filtered = byNewReplies(sessions, unread).filter(
    (s) => titleMatches(s, filter) && (tab !== "approval" || s.waiting),
  );
  return (
    <ScrollArea
      className="conversation-library conversation-panel-list"
      viewportLabel="Conversations"
    >
      <section className="library-page">
        <div className="library-search">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear conversation search"
              onClick={clearSearch}
            >
              <X size={13} />
            </Button>
          )}
        </div>
        <div
          className="library-filters"
          role="group"
          aria-label="Filter conversations"
        >
          {(
            [
              ["all", "All"],
              ["approval", "Approvals"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant="ghost"
              size="xs"
              aria-pressed={tab === id}
              aria-label={`${label}, ${counts[id]}`}
              onClick={() => setTab(id)}
              className="library-filter h-7 rounded-full border px-2 text-[11px]"
            >
              <span className="library-filter-label">{label}</span>
              {id !== "all" && counts[id] > 0 && (
                <span className="library-filter-count" aria-hidden="true">
                  {counts[id]}
                </span>
              )}
            </Button>
          ))}
        </div>
        <p className="library-results" role="status">
          {filtered.length}{" "}
          {filtered.length === 1 ? "conversation" : "conversations"}
          {filter ? ` matching “${filter}”` : " · New replies first"}
        </p>
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
                unreadCount={unread(s)}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                className="library-row-archive"
                aria-label={`Archive ${s.title}`}
                title="Archive"
                onClick={() => onArchive(s)}
              >
                <Archive size={14} />
              </Button>
            </div>
          ))}
        </nav>
        {!filtered.length && (
          <div className="library-empty">
            <MessageSquareText size={24} aria-hidden="true" />
            <p>
              {filter
                ? "No matching conversations."
                : tab === "all"
                  ? "No conversations yet."
                  : "You’re all caught up."}
            </p>
            {filter && (
              <Button variant="outline" size="sm" onClick={clearSearch}>
                Clear search
              </Button>
            )}
          </div>
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
