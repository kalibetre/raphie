import type { BotProfile, SessionSummary } from "@raphie/contracts";
import { Plus, Settings } from "lucide-react";

import brandMark from "../../../shared/favicon.svg?inline";
import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import {
  presence,
  runtimePlace,
  waitingLine,
  waitingOnOwner,
} from "../application/team-presence";
import { BotAvatar } from "./bot-avatar";
import { useBotStyle } from "./bot-tones";

export function BotSidebar({
  bots,
  botId,
  byBot,
  unread,
  onSelect,
  onOpen,
  onSettings,
  onCreate,
  connected,
  error,
  onRetry,
  needsSetup = false,
}: {
  bots: BotProfile[];
  botId: string;
  byBot: Map<string, SessionSummary[]>;
  unread: (botId: string, session: SessionSummary) => number;
  onSelect: (id: string) => void;
  /** Opens one of a bot's sessions, such as one waiting for an approval. */
  onOpen: (botId: string, sessionId: string) => void;
  onSettings: () => void;
  onCreate: () => void;
  connected: boolean;
  error: boolean;
  onRetry: () => void;
  /** The selected bot has no model yet; others are not known here. */
  needsSetup?: boolean;
}) {
  const botStyle = useBotStyle();
  // What waits on the owner, one line per teammate, pinned on top.
  const requests = bots
    .flatMap((b) => {
      const waiting = waitingOnOwner(byBot.get(b.id) ?? []);
      return waiting ? [{ bot: b, ...waiting }] : [];
    })
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 3);
  return (
    <div className="bot-roster">
      {requests.length > 0 && (
        <section className="roster-requests" aria-label="Needs you">
          {requests.map(({ bot, session: s, count, asking }) => (
            <button
              key={bot.id}
              className="roster-request"
              style={botStyle(bot.id)}
              onClick={() => onOpen(bot.id, s.sessionId)}
            >
              <BotAvatar id={bot.id} />
              <span className="roster-request-copy">
                <strong>{waitingLine(bot.name, count, asking)}</strong>
                <span>{s.title}</span>
              </span>
            </button>
          ))}
        </section>
      )}
      <div className="roster-label">Your team</div>
      <ScrollArea
        className="bot-roster-scroll [&_[data-slot=scroll-area-scrollbar]]:hidden"
        viewportLabel="Your team"
      >
        <nav className="bot-roster-list" aria-label="Your team">
          {bots.map((b) => {
            const status = presence(
              byBot.get(b.id) ?? [],
              (s) => unread(b.id, s),
              needsSetup && b.id === botId,
            );
            return (
              <button
                key={b.id}
                data-bot-nav
                className="bot-roster-item"
                style={botStyle(b.id)}
                aria-current={b.id === botId ? "page" : undefined}
                onClick={() => onSelect(b.id)}
                aria-label={`${b.name}, ${status.label}`}
              >
                <span className="roster-avatar">
                  <BotAvatar id={b.id} />
                  <span
                    className={`roster-presence ${status.state}`}
                    aria-hidden="true"
                  />
                </span>
                <span className="bot-roster-copy">
                  <span className="bot-roster-title">{b.name}</span>
                  <span className={`bot-roster-status ${status.state}`}>
                    {status.label}
                  </span>
                </span>
              </button>
            );
          })}
          {error && (
            <button className="sidebar-empty" onClick={onRetry}>
              Couldn’t load your team. Retry
            </button>
          )}
          {!error && !bots.length && (
            <p className="sidebar-empty">Loading your team…</p>
          )}
          <button className="bot-roster-item roster-add" onClick={onCreate}>
            <span className="roster-avatar roster-add-icon">
              <Plus size={15} />
            </span>
            <span className="bot-roster-copy">Add a teammate</span>
          </button>
        </nav>
      </ScrollArea>
      <footer className="roster-footer">
        <img className="roster-brand-mark" src={brandMark} alt="" />
        <span className="roster-brand-name">raphie</span>
        <span className="runtime-status" role="status">
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          {connected ? runtimePlace(location.href) : "Reconnecting…"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="roster-settings"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
        >
          <Settings />
        </Button>
      </footer>
    </div>
  );
}
