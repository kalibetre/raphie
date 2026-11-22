import type {
  Card,
  CardBadge,
  CardEvent,
  CardField,
  CardLink,
  CardProgress,
  CardRow,
  CardSteps,
  SessionCard,
} from "@raphie/contracts";
import { ArrowUpRight, Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { dueLabel, initials, localDate } from "../application/card-facts";
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

/** A calendar date written YYYY-MM-DD, read the same in any zone. */
const dated = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    ...options,
  });

/** "Monday 23 November" for "2026-11-23". */
const day = (date: string) =>
  dated(date, { weekday: "long", day: "numeric", month: "long" });

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

function Tone({ badge }: { badge: CardBadge }) {
  return (
    <Badge variant="secondary" className={TONES[badge.tone]}>
      {badge.label}
    </Badge>
  );
}

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

const Arrow = () => (
  <ArrowUpRight className="shown-card-arrow" size={12} aria-hidden="true" />
);

/** One coloured bar per source, when the card mixes several. */
function Sources({
  of,
  names,
  bar,
}: {
  of?: number[];
  names: string[];
  /** A timeline keeps the bar even when the card has one source. */
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

function Title({ title, url }: { title: string; url?: string }) {
  return url ? (
    <Out className="shown-card-title shown-card-out" href={url}>
      {title}
    </Out>
  ) : (
    <span className="shown-card-title">{title}</span>
  );
}

/** A second link beside a row, tall enough for a thumb. */
function Second({ link }: { link: CardLink }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="shown-card-second h-8 px-3 text-xs"
      nativeButton={false}
      render={<a href={link.url} target="_blank" rel="noopener noreferrer" />}
    >
      {link.label}
    </Button>
  );
}

/** Who has it: their initials, with the names for a pointer and a reader. */
function People({ names }: { names: string[] }) {
  return (
    <span
      className="shown-card-people"
      role="img"
      aria-label={`Assigned to ${names.join(", ")}`}
      title={names.join(", ")}
    >
      {names.slice(0, 3).map((name) => (
        <span key={name} className="shown-card-avatar" aria-hidden="true">
          {initials(name)}
        </span>
      ))}
    </span>
  );
}

const Tags = ({ tags }: { tags: string[] }) =>
  tags.map((tag) => (
    <span key={tag} className="shown-card-tag">
      {tag}
    </span>
  ));

function Progress({ progress }: { progress: CardProgress }) {
  return (
    <span
      className="shown-card-progress"
      role="img"
      aria-label={`${progress.done} of ${progress.total} steps done`}
    >
      <span className="shown-card-progress-track" aria-hidden="true">
        <span
          className="shown-card-progress-fill"
          style={{ width: `${(progress.done / progress.total) * 100}%` }}
        />
      </span>
      <span aria-hidden="true">
        {progress.done}/{progress.total}
      </span>
    </span>
  );
}

/** A due date: a badge when it is close or past, plain words otherwise. */
function Due({ date, today }: { date: string; today: string }) {
  const due = dueLabel(date, today);
  return due.soon ? (
    <Tone badge={{ label: due.label, tone: due.tone }} />
  ) : (
    <span>{due.label}</span>
  );
}

function Row({
  row,
  sources,
  today,
}: {
  row: CardRow;
  sources: string[];
  today: string;
}) {
  const meta =
    row.key ||
    row.detail ||
    row.tags ||
    row.progress ||
    row.badge ||
    row.due ||
    row.trailing;
  return (
    <li className="shown-card-row">
      <Sources of={row.sources} names={sources} />
      <span className="shown-card-main">
        <Title title={row.title} url={row.url} />
        {meta && (
          <span className="shown-card-meta">
            {row.key && <span className="shown-card-key">{row.key}</span>}
            {row.detail && <span>{row.detail}</span>}
            {row.tags && <Tags tags={row.tags} />}
            {row.progress && <Progress progress={row.progress} />}
            {row.badge && <Tone badge={row.badge} />}
            {row.due && <Due date={row.due} today={today} />}
            {row.trailing && (
              <span className="shown-card-trailing">{row.trailing}</span>
            )}
          </span>
        )}
      </span>
      {row.people && <People names={row.people} />}
      {row.link && <Second link={row.link} />}
    </li>
  );
}

function List({
  card,
  today,
}: {
  card: Extract<Card, { type: "list" }>;
  today: string;
}) {
  return (
    <>
      {card.groups.map((group, index) => (
        <section key={index} aria-label={group.label}>
          {group.label && (
            <h4 className="shown-card-group">
              <span>{group.label}</span>
            </h4>
          )}
          <ul className="shown-card-rows">
            {group.rows.map((row, n) => (
              <Row key={n} row={row} sources={card.sources} today={today} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Board({
  card,
  today,
}: {
  card: Extract<Card, { type: "board" }>;
  today: string;
}) {
  return (
    <>
      <div className="shown-card-spread" aria-hidden="true">
        {card.columns
          .filter((column) => column.count > 0)
          .map((column, n) => (
            <span
              key={n}
              className="shown-card-spread-part"
              data-color={column.color}
              style={{ flexGrow: column.count }}
            />
          ))}
      </div>
      <ul className="shown-card-legend" aria-label="Columns">
        {card.columns.map((column, n) => (
          <li key={n} className="shown-card-legend-item">
            <span
              className="shown-card-dot"
              data-color={column.color}
              aria-hidden="true"
            />
            {column.label}
            <strong className="shown-card-legend-count">{column.count}</strong>
          </li>
        ))}
      </ul>
      {card.columns
        .filter((column) => column.rows.length > 0)
        .map((column, index) => (
          <section key={index} aria-label={column.label}>
            <h4 className="shown-card-group">
              <span>{column.label}</span>
              <span>{column.count}</span>
            </h4>
            <ul className="shown-card-rows">
              {column.rows.map((row, n) => (
                <Row key={n} row={row} sources={card.sources} today={today} />
              ))}
              {column.count > column.rows.length && (
                <li className="shown-card-rest">
                  {column.count - column.rows.length} more in {column.label}
                </li>
              )}
            </ul>
          </section>
        ))}
    </>
  );
}

function Field({ field, today }: { field: CardField; today: string }) {
  return (
    <>
      <dt className="shown-card-field-label">{field.label}</dt>
      <dd className="shown-card-field-value">
        {field.badge && <Tone badge={field.badge} />}
        {field.people && (
          <>
            <People names={field.people} />
            <span>{field.people.join(", ")}</span>
          </>
        )}
        {field.due && (
          <>
            <span>
              {dated(field.due, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </span>
            {dueLabel(field.due, today).soon && (
              <Due date={field.due} today={today} />
            )}
          </>
        )}
        {field.tags && <Tags tags={field.tags} />}
        {field.value && <span>{field.value}</span>}
      </dd>
    </>
  );
}

function Steps({ steps }: { steps: CardSteps }) {
  return (
    <div className="shown-card-section">
      <p className="shown-card-section-label">
        Steps · {steps.done} of {steps.total}
      </p>
      <ul className="shown-card-steps">
        {steps.items.map((step, n) => (
          <li
            key={n}
            className="shown-card-step"
            data-done={step.done || undefined}
          >
            <span className="shown-card-check" aria-hidden="true">
              {step.done && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
            <span className="shown-card-step-label">{step.label}</span>
          </li>
        ))}
      </ul>
      {steps.total > steps.items.length && (
        <p className="shown-card-section-label">
          {steps.total - steps.items.length} more
        </p>
      )}
    </div>
  );
}

function Item({
  card,
  today,
}: {
  card: Extract<Card, { type: "item" }>;
  today: string;
}) {
  return (
    <>
      {card.fields.length > 0 && (
        <dl className="shown-card-fields">
          {card.fields.map((field, n) => (
            <Field key={n} field={field} today={today} />
          ))}
        </dl>
      )}
      {card.body && <p className="shown-card-body">{card.body}</p>}
      {card.steps && <Steps steps={card.steps} />}
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
    <ul className="shown-card-rows">
      {timelineRows(card.items, now).map((row, n) =>
        row.kind === "day" ? (
          <li key={n} className="shown-card-group">
            <span>{day(row.date)}</span>
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
            {row.current
              ? `Free until ${clock.format(row.end)}`
              : `Free ${range(row.start, row.end)}`}
          </li>
        ) : (
          <li
            key={n}
            className="shown-card-row"
            data-past={row.past || undefined}
          >
            <Sources of={row.event.sources} names={card.sources} bar />
            <span className="shown-card-main">
              <span className="shown-card-meta">
                <span className="shown-card-time">{span(row.event)}</span>
                {row.event.badge && <Tone badge={row.event.badge} />}
              </span>
              <Title title={row.event.title} url={row.event.url} />
              {row.event.detail && (
                <span className="shown-card-meta">{row.event.detail}</span>
              )}
            </span>
            {row.event.link && <Second link={row.event.link} />}
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * A card the bot showed in place of a list in its reply: rows, a day's
 * events, a board's columns or one task opened up, with links out.
 * Read-only, and laid out for a phone at every width.
 */
export function ShownCard({ shown }: { shown: SessionCard }) {
  const { card } = shown;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // The line for now moves, and a due date turns over at midnight.
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const today = localDate(now);
  const where = [
    card.type === "item" && card.key,
    card.sources.length === 1 && card.sources[0],
  ].filter(Boolean);
  return (
    <section className="shown-card" aria-label={card.title}>
      <header className="shown-card-head">
        <h3 className="shown-card-heading">
          {card.url ? (
            <Out className="shown-card-out" href={card.url}>
              {card.title}
              <Arrow />
            </Out>
          ) : (
            card.title
          )}
        </h3>
        <p className="shown-card-about">
          {where.map((part) => `${part} · `)}as of{" "}
          <time dateTime={new Date(shown.createdAt).toISOString()}>
            {asOf(shown.createdAt, now)}
          </time>
        </p>
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
        <List card={card} today={today} />
      ) : card.type === "timeline" ? (
        <Timeline card={card} now={now} />
      ) : card.type === "board" ? (
        <Board card={card} today={today} />
      ) : card.type === "item" ? (
        <Item card={card} today={today} />
      ) : null}
      {card.more &&
        (card.more.url ? (
          <Out className="shown-card-more shown-card-out" href={card.more.url}>
            {card.more.label}
            <Arrow />
          </Out>
        ) : (
          <p className="shown-card-more">{card.more.label}</p>
        ))}
    </section>
  );
}
