import type { BotProfile, SessionSummary } from "@raphie/contracts";
import { Plus, Settings } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { BotAvatar } from "./bot-avatar";
import { useBotStyle } from "./bot-tones";

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
  const botStyle = useBotStyle();
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
      <div className="roster-label">
        Your bots<span className="roster-total">{bots.length}</span>
      </div>
      <ScrollArea
        className="bot-roster-scroll [&_[data-slot=scroll-area-scrollbar]]:hidden"
        viewportLabel="Your bots"
        orientation="both"
      >
        <nav className="bot-roster-list" aria-label="Your bots">
          {bots.map((b) => {
            const sessions = byBot.get(b.id) ?? [];
            const count = sessions.filter(
              (s) => unread(b.id, s) > 0 || s.waiting,
            ).length;
            return (
              <button
                key={b.id}
                data-bot-nav
                className="bot-roster-item"
                style={botStyle(b.id)}
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
        </nav>
      </ScrollArea>
      <button
        type="button"
        className="new-bot-row hidden md:flex"
        onClick={onCreate}
      >
        <span className="new-bot-icon">
          <Plus size={16} />
        </span>
        New bot
      </button>
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
