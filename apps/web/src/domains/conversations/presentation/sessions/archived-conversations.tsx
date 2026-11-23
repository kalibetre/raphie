import type { SessionSummary } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../../../shared/ui/button";
import { titleMatches } from "../../application/session-summaries";
import { SessionCard } from "./session-card";

/**
 * Settings → Archived: one bot's archived conversations, searchable by
 * title. Opening one leaves Settings for it; Unarchive puts it back in the
 * sidebar.
 */
export function ArchivedConversations({
  botId,
  fetchArchived,
  onOpen,
  onUnarchive,
}: {
  botId: string;
  fetchArchived: () => Promise<SessionSummary[]>;
  onOpen: (session: SessionSummary) => void;
  onUnarchive: (session: SessionSummary) => Promise<void>;
}) {
  const archived = useQuery({
    queryKey: ["sessions", "archived", botId],
    queryFn: fetchArchived,
  });
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };
  const sessions = archived.data ?? [];
  const shown = sessions.filter((s) => titleMatches(s, query));
  if (archived.isPending)
    return (
      <p className="archived-status" role="status">
        Loading archived conversations…
      </p>
    );
  if (archived.error)
    return (
      <div className="archived-status" role="status">
        <p>Couldn’t load archived conversations.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void archived.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  return (
    <section
      className="archived-conversations"
      aria-label="Archived conversations"
    >
      <div className="library-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchInput}
          aria-label="Search archived conversations"
          placeholder="Search archived conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear archived search"
            onClick={clearSearch}
          >
            <X size={13} />
          </Button>
        )}
      </div>
      <p className="library-results" role="status">
        {shown.length} {shown.length === 1 ? "conversation" : "conversations"}
        {query.trim() ? ` matching “${query.trim()}”` : " · Most recent first"}
      </p>
      {shown.length ? (
        <ul className="library-list archived-list">
          {shown.map((s) => (
            <li className="archived-row" key={s.id}>
              <SessionCard
                session={s}
                selected={false}
                now={Date.now()}
                onSelect={() => onOpen(s)}
                unreadCount={0}
              />
              <Button
                variant="outline"
                size="sm"
                className="archived-row-restore"
                aria-label={`Unarchive ${s.title}`}
                onClick={() => void onUnarchive(s)}
              >
                <ArchiveRestore size={14} aria-hidden="true" />
                <span className="archived-row-restore-label">Unarchive</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="library-empty">
          <Archive size={24} aria-hidden="true" />
          <p>
            {query.trim()
              ? "No matching conversations."
              : "No archived conversations. Archive one from its row in the sidebar or from its title bar."}
          </p>
          {query && (
            <Button variant="outline" size="sm" onClick={clearSearch}>
              Clear search
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
