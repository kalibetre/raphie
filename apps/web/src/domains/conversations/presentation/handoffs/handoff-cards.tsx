import type { Handoff, ReadSession, TurnHandoff } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  CornerUpRight,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "../../../../shared/ui/button";
import { useIsMobile } from "../../../../shared/ui/use-mobile";
import { BotAvatar } from "../../../settings/presentation/bot-avatar";
import { useBotStyle } from "../../../settings/presentation/bot-tones";
import {
  requestsFromTurn,
  requestStatus,
  type SentRequest,
  statusLabel,
} from "../../application/handoffs";
import { markdownComponents } from "../markdown-components";
import { useLastSession } from "../sessions/last-session";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const duration = (ms: number) => {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} h`;
};

/**
 * Opens a session of another bot, keeping the workspace's bot search value.
 * With no session it goes back to the one last open with that bot, as the
 * bot list does; a phone shows the bot's conversations instead.
 */
export function useOpenSession() {
  const navigate = useNavigate();
  const lastSession = useLastSession();
  const mobile = useIsMobile();
  return (botId: string, requested?: string | null) => {
    const sessionId = requested ?? (mobile ? null : lastSession(botId));
    return sessionId
      ? navigate({
          to: "/sessions/$sessionId",
          params: { sessionId },
          search: { bot: botId === "default" ? undefined : botId },
        })
      : navigate({
          to: "/",
          search: { bot: botId === "default" ? undefined : botId },
        });
  };
}

export const handoffAnchor = (id: string, index: number) =>
  `handoff-${id}-${index}`;

function Status({ status }: { status: keyof typeof statusLabel }) {
  return (
    <span className="handoff-status" data-status={status}>
      {(status === "working" || status === "waiting") && (
        <span className="handoff-status-dot" aria-hidden="true" />
      )}
      {statusLabel[status]}
    </span>
  );
}

/**
 * The briefs this turn sent, under its reply. One card per brief; several
 * handed off at once share a card so a busy turn stays one block.
 */
export function HandoffCards({
  turnId,
  handoffs,
  onCancel,
}: {
  turnId: string;
  handoffs: readonly Handoff[];
  onCancel: (id: string) => Promise<unknown>;
}) {
  const sent = requestsFromTurn(handoffs, turnId);
  if (!sent.length) return null;
  if (sent.length === 1)
    return <RequestCard sent={sent[0]!} onCancel={onCancel} />;
  return <SharedCard sent={sent} />;
}

function RequestCard({
  sent,
  onCancel,
}: {
  sent: SentRequest;
  onCancel: (id: string) => Promise<unknown>;
}) {
  const open = useOpenSession();
  const [error, setError] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const { handoff, request, index } = sent;
  const status = requestStatus(sent);
  const active = status === "working" || status === "waiting";

  async function cancel() {
    setError(undefined);
    setCancelling(true);
    try {
      await onCancel(handoff.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not cancel. Please retry.",
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <article
      className="handoff-card"
      id={handoffAnchor(handoff.id, index)}
      aria-label={`Handoff to ${handoff.to.name}`}
    >
      <header className="handoff-card-head">
        <BotAvatar id={handoff.to.id} />
        <span className="handoff-card-label">
          {index === 0 ? "Asked" : "Follow-up to"} {handoff.to.name}
        </span>
        <span className="handoff-card-title">{handoff.title}</span>
        <Status status={status} />
      </header>
      <p className="handoff-brief">{request.brief}</p>
      {status === "waiting" && (
        <p className="handoff-waiting">
          <ShieldAlert size={14} aria-hidden="true" />
          {handoff.to.name} is waiting for your approval.
          <Button
            size="sm"
            variant="outline"
            onClick={() => void open(handoff.to.id, handoff.toSessionId)}
          >
            Review
          </Button>
        </p>
      )}
      <footer className="handoff-card-foot">
        <span className="handoff-card-time">
          Sent {time(request.sentAt)}
          {request.finishedAt
            ? ` · took ${duration(request.finishedAt - request.sentAt)}`
            : ""}
        </span>
        {error && (
          <span className="handoff-card-error" role="alert">
            {error}
          </span>
        )}
        <span className="handoff-card-spacer" />
        {active && handoff.toSessionId && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!handoff.toSessionId}
          onClick={() => void open(handoff.to.id, handoff.toSessionId)}
        >
          View in {handoff.to.name}
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </footer>
    </article>
  );
}

function SharedCard({ sent }: { sent: SentRequest[] }) {
  const open = useOpenSession();
  const bots = [...new Set(sent.map((s) => s.handoff.to.name))];
  return (
    <article
      className="handoff-card"
      aria-label={`Handoffs to ${bots.join(", ")}`}
    >
      <header className="handoff-card-head">
        <span className="handoff-card-label">
          Handed off {sent.length} tasks
        </span>
        <span className="handoff-card-title">{bots.join(", ")}</span>
      </header>
      <ul className="handoff-list">
        {sent.map((item) => (
          <li
            key={`${item.handoff.id}:${item.index}`}
            id={handoffAnchor(item.handoff.id, item.index)}
          >
            <BotAvatar id={item.handoff.to.id} />
            <span className="handoff-list-text">
              <strong>{item.handoff.to.name}</strong>
              <span title={item.request.brief}>{item.handoff.title}</span>
            </span>
            <Status status={requestStatus(item)} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!item.handoff.toSessionId}
              onClick={() =>
                void open(item.handoff.to.id, item.handoff.toSessionId)
              }
            >
              Open
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** A result coming back, in place of an owner message: the report is the other bot's. */
export function HandoffResult({
  handoff,
  text,
  at,
  record,
}: {
  handoff: TurnHandoff;
  text: string;
  at: number;
  /** The sending bot's record, for opening the other bot's session. */
  record?: Handoff;
}) {
  const open = useOpenSession();
  const [expanded, setExpanded] = useState(false);
  const outcome = handoff.outcome ?? "completed";
  const verb =
    outcome === "completed"
      ? "finished"
      : outcome === "cancelled"
        ? "stopped"
        : "could not finish";
  return (
    <article
      className="handoff-card handoff-result"
      aria-label={`Result from ${handoff.bot.name}`}
    >
      <header className="handoff-card-head">
        <BotAvatar id={handoff.bot.id} />
        <CornerDownLeft size={14} aria-hidden="true" />
        <span className="handoff-card-label">
          {handoff.bot.name} {verb}
        </span>
        <span className="handoff-card-title">{handoff.title}</span>
        <Status status={outcome} />
      </header>
      {expanded && (
        <div className="handoff-report markdown">
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm]}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}
      <footer className="handoff-card-foot">
        <time
          className="handoff-card-time"
          dateTime={new Date(at).toISOString()}
        >
          {time(at)}
        </time>
        <span className="handoff-card-spacer" />
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide report" : "Show report"}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={expanded ? "rotate-180" : undefined}
          />
        </Button>
        {record?.toSessionId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void open(handoff.bot.id, record.toSessionId)}
          >
            View in {handoff.bot.name}
            <ChevronRight size={14} aria-hidden="true" />
          </Button>
        )}
      </footer>
    </article>
  );
}

/**
 * Under a reply that read another bot's session for a task: where the
 * answer came from, and the way there.
 */
export function HandoffSources({ read }: { read: readonly ReadSession[] }) {
  const open = useOpenSession();
  const botStyle = useBotStyle();
  if (!read.length) return null;
  return (
    <ul className="handoff-sources" aria-label="Sessions this reply read">
      {read.map((session) => (
        <li key={session.handoffId}>
          <button
            type="button"
            className="handoff-source"
            style={botStyle(session.bot.id)}
            aria-label={`View in ${session.bot.name}: ${session.title}`}
            onClick={() => void open(session.bot.id, session.sessionId)}
          >
            <BotAvatar id={session.bot.id} />
            <span className="handoff-source-text">
              Read from <strong>{session.bot.name}</strong>
              <span className="handoff-source-title">{session.title}</span>
            </span>
            <span className="handoff-source-action">
              View in {session.bot.name}
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A task another bot handed off, in place of an owner message. */
export function HandoffBrief({
  handoff,
  text,
  at,
  followUp,
}: {
  handoff: TurnHandoff;
  text: string;
  at: number;
  followUp: boolean;
}) {
  return (
    <div className="handoff-brief-turn">
      <p className="handoff-marker">
        <CornerUpRight size={13} aria-hidden="true" />
        <span>
          {followUp ? "Follow-up from" : "Handed off by"}{" "}
          <strong>{handoff.bot.name}</strong>
        </span>
        <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
      </p>
      <article
        className="handoff-brief-card"
        aria-label={`Brief from ${handoff.bot.name}`}
      >
        <span className="handoff-brief-from">
          <BotAvatar id={handoff.bot.id} />
          <strong>{handoff.bot.name}</strong> asked
        </span>
        <div className="markdown">
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm]}
          >
            {text}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
