import type {
  Card,
  CardBadge,
  CardEvent,
  CardLink,
  CardRow,
  SessionCard,
} from "@raphie/contracts";
import { ArrowUpRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { timelineRows } from "../application/card-timeline";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * "14:00 – 15:00", or "2:00 – 3:00 PM" where the day has two halves. A span
 * across midnight is written as two times: a range would spell out both dates.
 */
const range = (start: number, end: number) =>
  new Date(start).toDateString() === new Date(end).toDateString()
    ? clock.formatRange(start, end)
    : `${clock.format(start)} – ${clock.format(end)}`;

/** "Monday 23 November" for the calendar date "2026-11-23", in any zone. */
const day = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/** "as of 10:42" today; an older card also says which day. */
function asOf(at: number, now: number) {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return sameDay
    ? time(at)
    : `${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time(at)}`;
}

const TONES: Record<CardBadge["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-(--accent-soft) text-(--accent)",
  attention: "bg-(--attention-soft) text-(--attention)",
  bad: "bg-muted text-(--error)",
};

/** Opens in a new tab; the runtime only passes http and https addresses. */
function Out({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

/** One coloured bar per source, when the card mixes several. */
function Sources({
  of,
  names,
  bar,
}: {
  of?: number[];
  names: string[];
  /** A timeline keeps the bar's column even when the card has one source. */
  bar?: boolean;
}) {
  if (names.length < 2 && !bar) return null;
  // With one source or none, a timeline's bar takes the first colour; with
  // several, an event that names none has no bar.
  const shown = of ?? (names.length < 2 ? [0] : []);
  const label = shown
    .flatMap((n) => (names[n] ? [names[n]] : []))
    .join(" and ");
  return (
    <span
      className="shown-card-bars"
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {shown.map((n) => (
        <span key={n} className="shown-card-bar" data-source={n % 4} />
      ))}
    </span>
  );
}

function Title({ item }: { item: Pick<CardRow, "title" | "url" | "detail"> }) {
  return (
    <span className="shown-card-main">
      {item.url ? (
        <Out className="shown-card-title shown-card-out" href={item.url}>
          {item.title}
        </Out>
      ) : (
        <span className="shown-card-title">{item.title}</span>
      )}
      {item.detail && <span className="shown-card-detail">{item.detail}</span>}
    </span>
  );
}

function Extras({
  badge,
  link,
  trailing,
}: {
  badge?: CardBadge;
  link?: CardLink;
  trailing?: string;
}) {
  if (!badge && !link && !trailing) return null;
  return (
    <span className="shown-card-extras">
      {badge && (
        <Badge variant="secondary" className={TONES[badge.tone]}>
          {badge.label}
        </Badge>
      )}
      {link && (
        <Button
          variant="outline"
          size="xs"
          nativeButton={false}
          render={
            <a href={link.url} target="_blank" rel="noopener noreferrer" />
          }
        >
          {link.label}
        </Button>
      )}
      {trailing && <span className="shown-card-trailing">{trailing}</span>}
    </span>
  );
}

function List({ card }: { card: Extract<Card, { type: "list" }> }) {
  return (
    <>
      {card.groups.map((group, index) => (
        <section key={index} aria-label={group.label}>
          {group.label && <h4 className="shown-card-group">{group.label}</h4>}
          <ul className="shown-card-rows">
            {group.rows.map((row, n) => (
              <li key={n} className="shown-card-row">
                <Sources of={row.sources} names={card.sources} />
                {row.key && <span className="shown-card-key">{row.key}</span>}
                <Title item={row} />
                <Extras
                  badge={row.badge}
                  link={row.link}
                  trailing={row.trailing}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const span = (event: CardEvent) =>
  event.allDay
    ? "All day"
    : event.end
      ? range(event.start, event.end)
      : clock.format(event.start);

function Timeline({
  card,
  now,
}: {
  card: Extract<Card, { type: "timeline" }>;
  now: number;
}) {
  return (
    <ul className="shown-card-rows shown-card-timeline">
      {timelineRows(card.items, now).map((row, n) =>
        row.kind === "day" ? (
          <li key={n} className="shown-card-group">
            {day(row.date)}
          </li>
        ) : row.kind === "now" ? (
          <li key={n} className="shown-card-now">
            <span>Now · {clock.format(row.at)}</span>
            <span className="shown-card-now-line" aria-hidden="true" />
          </li>
        ) : row.kind === "gap" ? (
          <li
            key={n}
            className="shown-card-gap"
            data-past={row.past || undefined}
          >
            <span className="shown-card-gap-text">
              {row.current
                ? `Free until ${clock.format(row.end)}`
                : `Free ${range(row.start, row.end)}`}
            </span>
          </li>
        ) : (
          <li
            key={n}
            className="shown-card-row"
            data-past={row.past || undefined}
          >
            <span className="shown-card-time">{span(row.event)}</span>
            <Sources of={row.event.sources} names={card.sources} bar />
            <Title item={row.event} />
            <Extras badge={row.event.badge} link={row.event.link} />
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * A card the bot showed in place of a list in its reply: rows or a day's
 * events, with links out. Read-only.
 */
export function ShownCard({ shown }: { shown: SessionCard }) {
  const { card } = shown;
  const [now, setNow] = useState(Date.now());
  const ticking = card.type === "timeline";
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return (
    <section className="shown-card" aria-label={card.title}>
      <header className="shown-card-head">
        <h3 className="shown-card-heading">
          {card.url ? (
            <Out className="shown-card-out" href={card.url}>
              {card.title}
              <ArrowUpRight
                className="shown-card-arrow"
                size={12}
                aria-hidden="true"
              />
            </Out>
          ) : (
            card.title
          )}
        </h3>
        <span className="shown-card-meta">
          {card.sources.length === 1 && `${card.sources[0]} · `}as of{" "}
          <time dateTime={new Date(shown.createdAt).toISOString()}>
            {asOf(shown.createdAt, now)}
          </time>
        </span>
      </header>
      {card.sources.length > 1 && (
        <ul className="shown-card-legend" aria-label="Sources">
          {card.sources.map((name, n) => (
            <li key={n} className="shown-card-legend-item">
              <span
                className="shown-card-dot"
                data-source={n % 4}
                aria-hidden="true"
              />
              {name}
            </li>
          ))}
        </ul>
      )}
      {card.stats && (
        <dl className="shown-card-stats">
          {card.stats.map((stat, n) => (
            <div key={n} className="shown-card-stat">
              <dt className="shown-card-stat-label">{stat.label}</dt>
              <dd className="shown-card-stat-value">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.warning && (
        <p className="shown-card-warning" role="note">
          {card.warning}
        </p>
      )}
      {card.type === "list" ? (
        <List card={card} />
      ) : (
        <Timeline card={card} now={now} />
      )}
      {card.more &&
        (card.more.url ? (
          <Out className="shown-card-more shown-card-out" href={card.more.url}>
            {card.more.label}
            <ArrowUpRight
              className="shown-card-arrow"
              size={12}
              aria-hidden="true"
            />
          </Out>
        ) : (
          <p className="shown-card-more">{card.more.label}</p>
        ))}
    </section>
  );
}
