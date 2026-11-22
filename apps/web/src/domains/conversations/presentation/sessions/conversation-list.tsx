import type { SessionSummary } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  MessageSquareText,
  Search,
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
  fetchArchived,
  onArchive,
}: {
  name: string;
  sessions: SessionSummary[];
  selectedId?: string;
  unread: (session: SessionSummary) => number;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadMore: () => void;
  /** The bot's archived conversations, fetched when that filter opens. */
  fetchArchived: () => Promise<SessionSummary[]>;
  onArchive: (session: SessionSummary, archived: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    setFilter("");
    searchInput.current?.focus();
  };
  const [tab, setTab] = useState<"all" | "unread" | "approval" | "archived">(
    "all",
  );
  const archived = useQuery({
    queryKey: ["sessions", "archived"],
    enabled: tab === "archived",
    queryFn: fetchArchived,
  });
  const counts = {
    all: sessions.length,
    unread: sessions.filter((s) => unread(s) > 0).length,
    approval: sessions.filter((s) => s.waiting).length,
    archived: 0,
  };
  const shown = tab === "archived" ? (archived.data ?? []) : sessions;
  const filtered = shown.filter(
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
              ["unread", "New replies"],
              ["approval", "Approvals"],
              ["archived", "Archived"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant="ghost"
              size="xs"
              aria-pressed={tab === id}
              aria-label={id === "archived" ? label : `${label}, ${counts[id]}`}
              title={id === "archived" ? label : undefined}
              onClick={() => setTab(id)}
              className="library-filter h-7 rounded-full border px-2 text-[11px]"
            >
              {id === "archived" ? (
                // An icon keeps the four filters on one row in the sidebar;
                // it is the same box as the archive buttons.
                <Archive size={13} aria-hidden="true" />
              ) : (
                <span className="library-filter-label">{label}</span>
              )}
              {id !== "all" && id !== "archived" && counts[id] > 0 && (
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
          {tab === "archived" ? " archived" : ""}
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
                unreadCount={s.archivedAt ? 0 : unread(s)}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                className="library-row-archive"
                aria-label={`${s.archivedAt ? "Unarchive" : "Archive"} ${s.title}`}
                title={s.archivedAt ? "Unarchive" : "Archive"}
                onClick={() => onArchive(s, !s.archivedAt)}
              >
                {s.archivedAt ? (
                  <ArchiveRestore size={14} />
                ) : (
                  <Archive size={14} />
                )}
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
                : tab === "archived"
                  ? archived.isPending
                    ? "Loading archived conversations…"
                    : "No archived conversations."
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
        {hasMore && tab !== "archived" && (
          <Button variant="outline" onClick={loadMore}>
            Load more conversations
          </Button>
        )}
      </section>
    </ScrollArea>
  );
}
