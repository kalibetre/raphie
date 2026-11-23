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
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/ui/collapsible";
import { dueLabel, initials, localDate } from "../application/card-facts";
import {
  duration,
  schedule,
  type ScheduleDay,
  type ScheduleNext,
  type ScheduleStrip,
} from "../application/card-schedule";

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
const longDay = (date: string) =>
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
      {names.map((name) => (
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

/** "9:30" or "14:30": a time without its "AM" or "PM", for the time column. */
function bare(at: number) {
  return clock
    .formatToParts(at)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

/** "Today", "Tomorrow", "Yesterday" or the weekday of a day further off. */
const dayName = (day: ScheduleDay) =>
  day.offset === 0
    ? "Today"
    : day.offset === 1
      ? "Tomorrow"
      : day.offset === -1
        ? "Yesterday"
        : dated(day.date, { weekday: "long" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How full a day is: its events, the time they take and when it frees up. */
function Summary({ day }: { day: ScheduleDay }) {
  return (
    <p className="shown-card-summary">
      <span>
        <strong>{day.events}</strong> {day.events === 1 ? "event" : "events"}
      </span>
      {day.booked > 0 && (
        <span>
          <strong>{duration(day.booked)}</strong> booked
        </span>
      )}
      {day.freeAfter !== undefined && (
        <span>
          free after <strong>{clock.format(day.freeAfter)}</strong>
        </span>
      )}
    </p>
  );
}

/** The day at a glance: a bar of busy time with a mark for now. */
function Strip({ strip }: { strip: ScheduleStrip }) {
  const at = (moment: number) =>
    `${((moment - strip.from) / (strip.to - strip.from)) * 100}%`;
  return (
    <div className="shown-card-glance" aria-hidden="true">
      <div className="shown-card-strip">
        {strip.blocks.map((block, n) => (
          <span
            key={n}
            className="shown-card-block"
            data-source={block.source % 4}
            data-lane={block.lane}
            data-split={block.split || undefined}
            data-past={block.past || undefined}
            style={{
              left: at(block.start),
              width: `calc(${at(block.end)} - ${at(block.start)})`,
            }}
          />
        ))}
        {strip.now !== undefined && (
          <span className="shown-card-tick" style={{ left: at(strip.now) }} />
        )}
      </div>
      <div className="shown-card-hours">
        {strip.hours.map((hour, n) => (
          <span
            key={hour}
            className="shown-card-hour"
            data-edge={
              n === 0
                ? "start"
                : n === strip.hours.length - 1
                  ? "end"
                  : undefined
            }
            style={{ left: at(hour) }}
          >
            {hourLabel.format(hour)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** What is on now, or the next thing today, with its link to join. */
function Next({ next, now }: { next: ScheduleNext; now: number }) {
  const { event, current } = next;
  const when = current
    ? event.end
      ? `Now · ends in ${duration(event.end - now)}`
      : "Now"
    : `Next · in ${duration(event.start - now)}`;
  return (
    <div className="shown-card-next">
      <div className="shown-card-main">
        <p className="shown-card-next-when">{when}</p>
        <Title title={event.title} url={event.url} />
        <p className="shown-card-meta">
          <span className="shown-card-time">{span(event)}</span>
          {event.detail && <span>{event.detail}</span>}
        </p>
      </div>
      {event.link && (
        <Button
          size="sm"
          className="shown-card-second h-8 px-3 text-xs"
          nativeButton={false}
          render={
            <a
              href={event.link.url}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          {event.link.label}
        </Button>
      )}
    </div>
  );
}

/** One timed event: start over end in a column, then the event itself. */
function Event({
  event,
  past,
  sources,
}: {
  event: CardEvent;
  past: boolean;
  sources: string[];
}) {
  return (
    <li className="shown-card-event" data-past={past || undefined}>
      <span className="shown-card-when">
        <time
          className="shown-card-when-start"
          dateTime={new Date(event.start).toISOString()}
        >
          {event.end ? bare(event.start) : clock.format(event.start)}
        </time>
        {/* The end says "AM" or "PM", so the start can leave it out. */}
        {event.end && (
          <span className="shown-card-when-end">{clock.format(event.end)}</span>
        )}
      </span>
      <Sources of={event.sources} names={sources} bar />
      <span className="shown-card-main">
        <Title title={event.title} url={event.url} />
        {(event.detail || event.badge) && (
          <span className="shown-card-meta">
            {event.detail && <span>{event.detail}</span>}
            {event.badge && <Tone badge={event.badge} />}
          </span>
        )}
      </span>
      {event.link && <Second link={event.link} />}
    </li>
  );
}

/** Today's events already over, as one line that opens to show them. */
function Earlier({
  events,
  sources,
}: {
  events: CardEvent[];
  sources: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="shown-card-earlier">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="shown-card-earlier-trigger">
          <ChevronRight
            className="shown-card-earlier-chevron"
            size={14}
            aria-hidden="true"
          />
          <span>
            {events.length} earlier ·{" "}
            {events.map((event) => event.title).join(", ")}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="shown-card-rows">
            {events.map((event, n) => (
              <Event key={n} event={event} past sources={sources} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** One day of a schedule: its all-day events, what is next and its agenda. */
function Day({
  day,
  sources,
  now,
  several,
}: {
  day: ScheduleDay;
  sources: string[];
  now: number;
  several: boolean;
}) {
  return (
    <section aria-label={day.date}>
      {several && (
        <h4 className="shown-card-day">
          <span>{dayName(day)}</span>
          <span className="shown-card-day-about">
            {dated(day.date, {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}{" "}
            · {plural(day.events, "event")}
          </span>
        </h4>
      )}
      {day.strip && <Strip strip={day.strip} />}
      {day.allDay.length > 0 && (
        <ul className="shown-card-allday" aria-label="All day">
          {day.allDay.map((event, n) => (
            <li key={n} className="shown-card-chip">
              <span
                className="shown-card-dot"
                data-source={(event.sources?.[0] ?? 0) % 4}
                aria-hidden="true"
              />
              <Title title={event.title} url={event.url} />
            </li>
          ))}
        </ul>
      )}
      {day.next && <Next next={day.next} now={now} />}
      {(day.earlier.length > 0 || day.rows.length > 0) && (
        <ul className="shown-card-rows shown-card-agenda">
          {day.earlier.length > 0 && (
            <Earlier events={day.earlier} sources={sources} />
          )}
          {day.rows.map((row, n) =>
            row.kind === "now" ? (
              <li key={n} className="shown-card-now">
                <span className="shown-card-now-at">{bare(row.at)}</span>
                <span className="shown-card-now-line" aria-hidden="true" />
              </li>
            ) : row.kind === "gap" ? (
              <li
                key={n}
                className="shown-card-gap"
                data-past={row.past || undefined}
              >
                <span>
                  {row.current
                    ? `Free until ${clock.format(row.end)}`
                    : `Free ${duration(row.end - row.start)}`}
                </span>
              </li>
            ) : (
              <Event
                key={n}
                event={row.event}
                past={row.past}
                sources={sources}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Schedule({
  days,
  sources,
  now,
}: {
  days: ScheduleDay[];
  sources: string[];
  now: number;
}) {
  return days.map((day) => (
    <Day
      key={day.date}
      day={day}
      sources={sources}
      now={now}
      several={days.length > 1}
    />
  ));
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
  const days = card.type === "timeline" ? schedule(card.items, now) : [];
  // A schedule of one day is headed by that day, read from its events.
  const single = days.length === 1 ? days[0] : undefined;
  const heading = single ? dayName(single) : card.title;
  const where = [
    card.type === "item" && card.key,
    card.sources.length === 1 && card.sources[0],
  ].filter(Boolean);
  return (
    <section className="shown-card" aria-label={card.title}>
      <header className="shown-card-head">
        {single && <p className="shown-card-eyebrow">{longDay(single.date)}</p>}
        <h3 className="shown-card-heading">
          {card.url ? (
            <Out className="shown-card-out" href={card.url}>
              {heading}
              <Arrow />
            </Out>
          ) : (
            heading
          )}
        </h3>
        <p className="shown-card-about">
          {where.map((part) => `${part} · `)}as of{" "}
          <time dateTime={new Date(shown.createdAt).toISOString()}>
            {asOf(shown.createdAt, now)}
          </time>
        </p>
        {single && <Summary day={single} />}
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
        <Schedule days={days} sources={card.sources} now={now} />
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
