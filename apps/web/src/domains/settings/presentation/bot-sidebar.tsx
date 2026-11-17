import type { BotProfile, SessionSummary } from "@raphie/contracts";
import { Plus, Settings, SquarePen } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { AccountMenu } from "./account-menu";
import { BotAvatar } from "./bot-avatar";
import { useBotStyle } from "./bot-tones";

export function BotSidebar({
  bots,
  botId,
  byBot,
  unread,
  onSelect,
  onSettings,
  onAccount,
  onCreate,
  connected,
  error,
  onRetry,
  conversations,
  onNew,
}: {
  bots: BotProfile[];
  botId: string;
  byBot: Map<string, SessionSummary[]>;
  unread: (botId: string, session: SessionSummary) => number;
  onSelect: (id: string) => void;
  onSettings: () => void;
  onAccount: () => void;
  onCreate: () => void;
  connected: boolean;
  error: boolean;
  onRetry: () => void;
  /** The selected bot's conversation list, below the bots; none on a phone,
   * where the roster is a strip and the list has the screen. */
  conversations?: ReactNode;
  onNew?: () => void;
}) {
  const botStyle = useBotStyle();
  const current = bots.find((b) => b.id === botId);
  return (
    <div className="bot-roster">
      <div className="roster-brand">
        <span className="brand">
          <span className="roster-brand-avatar">
            <BotAvatar id="default" />
          </span>
          raphie
        </span>
      </div>
      <div className="roster-label">
        Your bots
        <Button
          variant="ghost"
          size="icon-xs"
          className="roster-label-action"
          aria-label="New bot"
          title="New bot"
          onClick={onCreate}
        >
          <Plus size={14} />
        </Button>
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
      {conversations && (
        <section
          className="roster-conversations"
          aria-label={`${current?.name ?? "Raphie"}’s conversations`}
        >
          <div className="roster-label">
            <span className="roster-label-text">
              {current?.name ?? "Raphie"}’s conversations
            </span>
            {onNew && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="roster-label-action"
                aria-label="New conversation"
                title="New conversation"
                onClick={onNew}
              >
                <SquarePen size={13} />
              </Button>
            )}
          </div>
          {conversations}
        </section>
      )}
      <footer className="roster-footer">
        <span className="runtime-status">
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        <div className="flex items-center gap-1">
          <AccountMenu onManage={onAccount} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            title="Settings"
            onClick={onSettings}
          >
            <Settings size={15} />
          </Button>
        </div>
      </footer>
    </div>
  );
}
