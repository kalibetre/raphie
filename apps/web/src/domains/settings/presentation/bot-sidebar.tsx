import type { BotProfile, SessionSummary } from "@raphie/contracts";
import { Plus, Search, Settings } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { BotAvatar, botTone } from "./bot-avatar";

export function BotSidebar({
  bots,
  botId,
  byBot,
  unread,
  onSelect,
  onSettings,
  onCreate,
  connected,
  error,
  onRetry,
}: {
  bots: BotProfile[];
  botId: string;
  byBot: Map<string, SessionSummary[]>;
  unread: (botId: string, session: SessionSummary) => number;
  onSelect: (id: string) => void;
  onSettings: () => void;
  onCreate: () => void;
  connected: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = bots.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="bot-roster">
      <div className="roster-brand">
        <span className="brand">
          <span className="roster-brand-avatar">
            <BotAvatar id="default" />
          </span>
          raphie
        </span>
        <span className="local-label">LOCAL</span>
      </div>
      <label className="search-field bot-search">
        <Search size={14} />
        <input
          aria-label="Find a bot"
          placeholder="Find a bot…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <div className="roster-label">
        Your bots<span className="roster-total">{bots.length}</span>
      </div>
      <ScrollArea
        className="bot-roster-scroll [&_[data-slot=scroll-area-scrollbar]]:hidden"
        viewportLabel="Your bots"
        orientation="both"
      >
        <nav className="bot-roster-list" aria-label="Your bots">
          {filtered.map((b) => {
            const sessions = byBot.get(b.id) ?? [];
            const count = sessions.filter(
              (s) => unread(b.id, s) > 0 || s.waiting,
            ).length;
            return (
              <button
                key={b.id}
                data-bot-nav
                className={`bot-roster-item tone-${botTone(b.id)}`}
                aria-current={b.id === botId ? "page" : undefined}
                onClick={() => onSelect(b.id)}
                aria-label={`${b.name}${count ? `, ${count} conversations need attention` : ""}`}
              >
                <span className="roster-avatar">
                  <BotAvatar id={b.id} />
                </span>
                <span className="bot-roster-copy">
                  <span className="bot-roster-name">
                    <span className="bot-roster-title">{b.name}</span>
                    {count > 0 && <span className="reply-count">{count}</span>}
                  </span>
                  <span className="bot-roster-preview">
                    {count
                      ? `${count} ${count === 1 ? "conversation needs" : "conversations need"} you`
                      : sessions[0]?.preview ||
                        b.description ||
                        "Start a conversation"}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            className="mobile-create-bot"
            onClick={onCreate}
            aria-label="Create a bot"
          >
            <Plus size={18} />
          </button>
          {error && (
            <button className="sidebar-empty" onClick={onRetry}>
              Couldn’t load bots. Retry
            </button>
          )}
          {!error && !bots.length && (
            <p className="sidebar-empty">Loading bots…</p>
          )}
          {!error && bots.length > 0 && !filtered.length && (
            <p className="sidebar-empty" role="status">
              No matching bots.
            </p>
          )}
        </nav>
      </ScrollArea>
      <Button
        className="new-bot-button hidden justify-start md:inline-flex"
        variant="outline"
        onClick={onCreate}
      >
        <Plus size={14} /> New bot
      </Button>
      <footer className="roster-footer">
        <span className="runtime-status">
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          {connected ? "Connected locally" : "Reconnecting…"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
        >
          <Settings size={15} />
        </Button>
      </footer>
    </div>
  );
}
