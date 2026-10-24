import type { SessionSummary } from "@raphie/contracts";
import {
  CheckCheck,
  MessageSquareText,
  Search,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../../../shared/ui/button";
import { ScrollArea } from "../../../../shared/ui/scroll-area";
import { SessionCard } from "./session-card";

/** Filterable, searchable list of one bot's conversations. */
export function ConversationList({
  name,
  sessions,
  selectedId,
  unread,
  onSelect,
  hasMore,
  loadMore,
}: {
  name: string;
  sessions: SessionSummary[];
  selectedId?: string;
  unread: (session: SessionSummary) => number;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadMore: () => void;
}) {
  const [filter, setFilter] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    setFilter("");
    searchInput.current?.focus();
  };
  const [tab, setTab] = useState<"all" | "unread" | "approval">("all");
  const counts = {
    all: sessions.length,
    unread: sessions.filter((s) => unread(s) > 0).length,
    approval: sessions.filter((s) => s.waiting).length,
  };
  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(filter.toLowerCase()) &&
      (tab !== "unread" || unread(s) > 0) &&
      (tab !== "approval" || s.waiting),
  );
  return (
    <ScrollArea
      className="conversation-library conversation-panel-list"
      viewportLabel="Conversations"
    >
      <section className="library-page">
        <div
          className="library-filters"
          role="group"
          aria-label="Filter conversations"
        >
          {(
            [
              ["all", "All", MessageSquareText],
              ["unread", "New replies", CheckCheck],
              ["approval", "Approvals", ShieldQuestion],
            ] as const
          ).map(([id, label, Icon]) => (
            <Button
              key={id}
              variant={tab === id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tab === id}
              aria-label={`${label}, ${counts[id]}`}
              onClick={() => setTab(id)}
              className="library-filter"
            >
              <Icon size={14} aria-hidden="true" />
              <span className="library-filter-label">{label}</span>
              <span className="library-filter-count">{counts[id]}</span>
            </Button>
          ))}
        </div>
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
        <p className="library-results" role="status">
          {filtered.length}{" "}
          {filtered.length === 1 ? "conversation" : "conversations"}
          {filter ? ` matching “${filter}”` : " · Most recent first"}
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
                  ? "Your conversations will appear here."
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
