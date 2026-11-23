import type { CardEvent, CardTimelineItem } from "@raphie/contracts";

import { localDate } from "./card-facts";
import { type TimelineRow, timelineRows } from "./card-timeline";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY_MS = 24 * HOUR;

/** The working day a strip always covers, in local hours. */
const STRIP_FROM = 8;
const STRIP_TO = 18;

/** An event drawn on the day strip, on the first lane or, overlapping it, the second. */
export type ScheduleBlock = {
  start: number;
  end: number;
  lane: 0 | 1;
  /** It shares its time with a block on the other lane, so takes half the height. */
  split: boolean;
  /** Its first source's position, for the colour. */
  source: number;
  past: boolean;
};

/**
 * The day at a glance: its events as blocks between two whole hours, with
 * the hours to label and where now falls.
 */
export type ScheduleStrip = {
  from: number;
  to: number;
  hours: number[];
  blocks: ScheduleBlock[];
  now?: number;
};

/** What is on now, or else the next thing today. */
export type ScheduleNext = { event: CardEvent; current: boolean };

/** One day of a timeline card, laid out as a schedule at `now`. */
export type ScheduleDay = {
  /** The calendar date, as YYYY-MM-DD. */
  date: string;
  /** Days from today: 0 today, 1 tomorrow, -1 yesterday. */
  offset: number;
  events: number;
  allDay: CardEvent[];
  /** Time in timed events, with overlaps counted once. */
  booked: number;
  /** When the last timed event ends, unless one has no end or it is over. */
  freeAfter?: number;
  /** Today only, when it has timed events. */
  strip?: ScheduleStrip;
  next?: ScheduleNext;
  /** Today's timed events already over, folded into one line. */
  earlier: CardEvent[];
  /** The rest, in order: events, free time and the line for now. */
  rows: Exclude<TimelineRow, { kind: "day" }>[];
};

/** Midnight at the start of a local calendar date, as epoch milliseconds. */
function midnight(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!).getTime();
}

/** A local hour of `date`, so a day with a clock change still lines up. */
const hourOf = (date: string, hour: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!, hour).getTime();
};

/** The calendar date an event falls on: an all-day one's start is midnight UTC. */
const dateOf = (event: CardEvent) =>
  event.allDay
    ? new Date(event.start).toISOString().slice(0, 10)
    : localDate(event.start);

const timed = (item: CardTimelineItem): item is CardEvent =>
  item.kind === "event" && !item.allDay;

/** The time covered by intervals, counting an overlap once. */
function covered(spans: { start: number; end: number }[]) {
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
    if (end <= reach) continue;
    total += end - Math.max(start, reach);
    reach = end;
  }
  return total;
}

function strip(date: string, events: CardEvent[], now: number): ScheduleStrip {
  const first = Math.min(...events.map((e) => e.start));
  const last = Math.max(...events.map((e) => e.end ?? e.start + 15 * MINUTE));
  const base = midnight(date);
  // Rounded out to whole hours, and never narrower than a working day.
  const fromHour = Math.max(
    0,
    Math.min(STRIP_FROM, Math.floor((first - base) / HOUR)),
  );
  const toHour = Math.min(
    24,
    Math.max(STRIP_TO, Math.ceil((last - base) / HOUR)),
  );
  const from = hourOf(date, fromHour);
  const to = hourOf(date, toHour);
  const hours = [fromHour];
  for (let hour = fromHour + 1; hour < toHour; hour++)
    // Far enough from the ends that labels never run into each other.
    if (hour % 3 === 0 && hour - fromHour >= 2 && toHour - hour >= 3)
      hours.push(hour);
  hours.push(toHour);
  const blocks: ScheduleBlock[] = [];
  let laneEnd = Number.NEGATIVE_INFINITY;
  for (const event of [...events].sort((a, b) => a.start - b.start)) {
    // An event with no end is drawn a quarter of an hour long.
    const end = event.end ?? event.start + 15 * MINUTE;
    const start = Math.max(from, event.start);
    const clipped = Math.min(to, end);
    if (clipped <= start) continue;
    const lane = event.start < laneEnd ? 1 : 0;
    if (lane === 0) laneEnd = end;
    blocks.push({
      start,
      end: clipped,
      lane,
      split: lane === 1,
      source: event.sources?.[0] ?? 0,
      past: end <= now,
    });
  }
  for (const second of blocks.filter((block) => block.lane === 1))
    for (const first of blocks)
      if (
        first.lane === 0 &&
        first.start < second.end &&
        second.start < first.end
      )
        first.split = true;
  return {
    from,
    to,
    hours: hours.map((hour) => hourOf(date, hour)),
    blocks,
    ...(from <= now && now <= to ? { now } : {}),
  };
}

function laidOut(
  date: string,
  items: CardTimelineItem[],
  now: number,
): ScheduleDay {
  const events = items.filter((item) => item.kind === "event");
  const times = items.filter(timed);
  const offset = Math.round(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${localDate(now)}T00:00:00Z`)) /
      DAY_MS,
  );
  const today = offset === 0;
  const lastEnd = times.every((e) => e.end !== undefined)
    ? Math.max(...times.map((e) => e.end!))
    : undefined;
  const current = today
    ? times.find((e) => e.start <= now && now < (e.end ?? e.start))
    : undefined;
  const upcoming = today ? times.find((e) => e.start > now) : undefined;
  const next = current ?? upcoming;
  const over = today ? times.filter((e) => (e.end ?? e.start) <= now) : [];
  // Once the whole day is over there is nothing left to fold it under.
  const fold = over.length > 0 && over.length < times.length;
  const earlier = fold ? over : [];
  const rows = timelineRows(items, now).filter(
    (row): row is ScheduleDay["rows"][number] =>
      row.kind !== "day" &&
      !(row.kind === "event" && (row.event.allDay || (fold && row.past))) &&
      !(row.kind === "gap" && fold && row.past),
  );
  return {
    date,
    offset,
    events: events.length,
    allDay: events.filter((e) => e.allDay),
    booked: covered(
      times.flatMap((e) => (e.end ? [{ start: e.start, end: e.end }] : [])),
    ),
    ...(lastEnd !== undefined &&
    Number.isFinite(lastEnd) &&
    (!today || lastEnd > now)
      ? { freeAfter: lastEnd }
      : {}),
    ...(today && times.length ? { strip: strip(date, times, now) } : {}),
    ...(next ? { next: { event: next, current: next === current } } : {}),
    earlier,
    rows,
  };
}

/**
 * A timeline card as a schedule: one entry a day, each with how busy it is
 * and, for today, a strip of the day, what is on or next, and what is over
 * folded away. Everything is worked out from the events' times, so a card
 * saved before reads the same way.
 */
export function schedule(
  items: CardTimelineItem[],
  now: number,
): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  let date: string | undefined;
  let run: CardTimelineItem[] = [];
  const close = () => {
    const first = run.find((item) => item.kind === "event");
    const on = date ?? (first ? dateOf(first) : undefined);
    if (on && run.length) days.push(laidOut(on, run, now));
    run = [];
  };
  for (const item of items) {
    if (item.kind === "day") {
      close();
      date = item.date;
    } else run.push(item);
  }
  close();
  return days;
}

/** "3h 45m", "45m" or "2h": a length of time, to the minute. */
export function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}
