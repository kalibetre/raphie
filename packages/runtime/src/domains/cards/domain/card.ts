import type {
  Card,
  CardBadge,
  CardEvent,
  CardGroup,
  CardLink,
  CardRow,
  CardTimelineItem,
  CardTone,
} from "@raphie/contracts";

/** Rows or events one card holds; the rest go behind its "more" line. */
export const MAX_CARD_ITEMS = 40;

/** Free time shorter than this between two events is not worth a line. */
const MIN_GAP_MS = 30 * 60_000;

type ItemInput = {
  title: string;
  url?: string;
  detail?: string;
  badge?: { label: string; tone?: CardTone };
  link?: { label: string; url: string };
  source?: string;
};

export type RowInput = ItemInput & { key?: string; trailing?: string };

export type EventInput = ItemInput & { start: string; end?: string };

/** What a bot passes to `show_card`. */
export type CardInput = {
  title: string;
  url?: string;
  source?: string;
  warning?: string;
  stats?: { label: string; value: string }[];
  more?: { label: string; url?: string };
  groups?: { label?: string; rows: RowInput[] }[];
  events?: EventInput[];
};

/** A card a bot showed, as the runtime stores it. */
export type StoredCard = {
  id: string;
  /** The `show_card` call that made it; a replayed call finds it again. */
  taskId: number;
  conversationId: number;
  turnId: string;
  createdAt: number;
  card: Card;
  /** The card as plain text, for chats that cannot draw it. */
  text: string;
};

export type BuiltCard =
  { card: Card; text: string; notes: string[] } | { error: string };

/** `url` if a client may open it: an absolute http or https address. */
function safeUrl(url: string | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** A date, or a date and time with its offset, as a calendar gives it. */
const MOMENT =
  /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/;

/** An instant, with the calendar date and time of day it is shown under. */
type Moment = { at: number; date: string; clock?: string };

/** The date and time of day of `at` in `zone`, as a clock there reads. */
function inZone(at: number, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    clock: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * When an event starts or ends. A time is placed on the owner's day when
 * their time zone is known, so a calendar that answers in UTC still groups
 * events as the owner lives them; otherwise it stays on the date as written.
 * A date alone is that date everywhere.
 */
function moment(value: string, zone: string | undefined): Moment | null {
  const text = value.trim();
  const match = MOMENT.exec(text);
  if (!match) return null;
  const date = match[1]!;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  // "2026-02-30" parses as 2 March; a date must be one the calendar has.
  if (
    Number.isNaN(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) !== date
  )
    return null;
  if (!match[2]) return { at: midnight, date };
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return { at, ...(zone ? inZone(at, zone) : { date, clock: match[2] }) };
}

type Tally = { sources: string[]; droppedLinks: number };

/** The parts every row and event share, with unsafe links left out. */
function item(input: ItemInput, from: string[], t: Tally) {
  const url = safeUrl(input.url);
  const linkUrl = safeUrl(input.link?.url);
  if (input.url && !url) t.droppedLinks++;
  if (input.link && !linkUrl) t.droppedLinks++;
  const positions: number[] = [];
  for (const source of from) {
    let position = t.sources.indexOf(source);
    if (position < 0) position = t.sources.push(source) - 1;
    if (!positions.includes(position)) positions.push(position);
  }
  const badge: CardBadge | undefined = input.badge?.label.trim()
    ? { label: input.badge.label.trim(), tone: input.badge.tone ?? "neutral" }
    : undefined;
  const link: CardLink | undefined =
    linkUrl && input.link?.label.trim()
      ? { label: input.link.label.trim(), url: linkUrl }
      : undefined;
  return {
    title: input.title.trim(),
    ...(url ? { url } : {}),
    ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
    ...(badge ? { badge } : {}),
    ...(link ? { link } : {}),
    positions,
  };
}

/** Where an item says it came from, or where the whole card did. */
function sourcesOf(input: ItemInput, fallback: string | undefined) {
  const source = (input.source ?? fallback)?.trim();
  return source ? [source] : [];
}

type Placed<T> = Omit<T, "sources"> & { positions: number[] };

/** Items name their sources only when the card has more than one. */
function withSources<T extends { positions: number[] }>(
  placed: T,
  several: boolean,
) {
  const { positions, ...rest } = placed;
  return several && positions.length ? { ...rest, sources: positions } : rest;
}

const suffix = (url?: string) => (url ? ` — ${url}` : "");

/** One item as a line of plain text, with its links at the end. */
function line(
  lead: string,
  it: Omit<CardRow, "sources">,
  sources: string[],
  positions: number[],
) {
  const parts = [
    [lead, it.title].filter(Boolean).join(" "),
    it.detail,
    it.badge?.label,
    it.trailing,
    sources.length > 1 && positions.length
      ? positions.map((p) => sources[p]).join(" + ")
      : undefined,
  ].filter(Boolean);
  return `• ${parts.join(" · ")}${suffix(it.url)}${
    it.link ? ` (${it.link.label}: ${it.link.url})` : ""
  }`;
}

/** An event as the bot gave it, with its times read. */
type ReadEvent = {
  input: EventInput;
  from: string[];
  start: number;
  end?: number;
  allDay: boolean;
  date: string;
  clock: string;
};

/** The same event read from two calendars is one event from both. */
function merged(events: ReadEvent[]) {
  const seen = new Map<string, ReadEvent>();
  for (const event of events) {
    const key = [
      event.input.title.trim().toLowerCase(),
      event.start,
      event.end ?? "",
      event.allDay,
    ].join("|");
    const first = seen.get(key);
    if (!first) {
      seen.set(key, event);
      continue;
    }
    for (const source of event.from)
      if (!first.from.includes(source)) first.from.push(source);
    // Only what the first reading lacks.
    first.input = {
      ...first.input,
      ...(!first.input.url && event.input.url ? { url: event.input.url } : {}),
      ...(!first.input.link && event.input.link
        ? { link: event.input.link }
        : {}),
      ...(!first.input.detail?.trim() && event.input.detail
        ? { detail: event.input.detail }
        : {}),
      ...(!first.input.badge && event.input.badge
        ? { badge: event.input.badge }
        : {}),
    };
  }
  return [...seen.values()];
}

type TimedEvent = Placed<CardEvent> & { date: string; clock: string };

/** When an event stops taking time; one without an end only marks its start. */
const until = (event: Pick<CardEvent, "start" | "end">) =>
  event.end ?? event.start + 1;

/** Marks timed events that share time with another, unless the bot badged them. */
function markOverlaps(events: TimedEvent[]) {
  const timed = events.filter((e) => !e.allDay);
  for (const event of timed)
    if (
      !event.badge &&
      timed.some(
        (other) =>
          other !== event &&
          other.start < until(event) &&
          event.start < until(other),
      )
    )
      event.badge = { label: "Overlaps", tone: "attention" };
}

const NOTHING =
  "A card needs at least one row or event with a title. When there is nothing to list, say so in your reply instead.";

/**
 * A bot's `show_card` arguments as the card clients draw and the text chats
 * read. Links that are not http or https are left out, the same event from
 * two sources is shown once, and events that share time are marked.
 * `timeZone` is the owner's, when they have said.
 */
export function buildCard(
  input: CardInput,
  options: { timeZone?: string } = {},
): BuiltCard {
  const hasGroups = !!input.groups?.length;
  const hasEvents = !!input.events?.length;
  if (hasGroups && hasEvents)
    return {
      error: "Pass groups for a list or events for a timeline, not both.",
    };
  if (!hasGroups && !hasEvents) return { error: NOTHING };
  const title = input.title.trim();
  if (!title) return { error: "A card needs a title." };
  const tally: Tally = { sources: [], droppedLinks: 0 };
  const notes: string[] = [];
  const url = safeUrl(input.url);
  if (input.url && !url) tally.droppedLinks++;
  const moreUrl = safeUrl(input.more?.url);
  if (input.more?.url && !moreUrl) tally.droppedLinks++;
  const stats = (input.stats ?? [])
    .map((s) => ({ label: s.label.trim(), value: s.value.trim() }))
    .filter((s) => s.label && s.value);
  const warning = input.warning?.trim();
  let more = input.more?.label.trim()
    ? { label: input.more.label.trim(), ...(moreUrl ? { url: moreUrl } : {}) }
    : undefined;
  const body: string[] = [];
  let shape:
    | { type: "list"; groups: CardGroup[] }
    | { type: "timeline"; items: CardTimelineItem[] };
  let left = 0;

  if (hasGroups) {
    let room = MAX_CARD_ITEMS;
    const groups: { label?: string; rows: Placed<CardRow>[] }[] = [];
    for (const group of input.groups!) {
      const titled = group.rows.filter((row) => row.title.trim());
      // Only rows that are shown count towards sources and dropped links.
      const rows = titled.slice(0, room).map((row) => ({
        ...(row.key?.trim() ? { key: row.key.trim() } : {}),
        ...item(row, sourcesOf(row, input.source), tally),
        ...(row.trailing?.trim() ? { trailing: row.trailing.trim() } : {}),
      }));
      left += titled.length - rows.length;
      room -= rows.length;
      if (rows.length)
        groups.push({
          ...(group.label?.trim() ? { label: group.label.trim() } : {}),
          rows,
        });
    }
    if (!groups.length) return { error: NOTHING };
    const several = tally.sources.length > 1;
    shape = {
      type: "list",
      groups: groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => withSources(row, several)),
      })),
    };
    for (const group of groups) {
      if (group.label) body.push("", group.label);
      for (const { positions, ...row } of group.rows)
        body.push(line(row.key ?? "", row, tally.sources, positions));
    }
  } else {
    const read: ReadEvent[] = [];
    for (const [index, event] of input.events!.entries()) {
      if (!event.title.trim()) continue;
      const start = moment(event.start, options.timeZone);
      const end = event.end ? moment(event.end, options.timeZone) : undefined;
      if (!start || end === null)
        return {
          error: `Event ${index + 1} ("${event.title}") has a time I cannot read. Give start and end as a date ("2026-11-23") for an all-day event, or a date and time with its UTC offset ("2026-11-23T14:00:00+03:00").`,
        };
      const allDay = !start.clock;
      // An end at or before the start says nothing about how long it runs.
      const ends = !allDay && end?.clock && end.at > start.at ? end : undefined;
      read.push({
        input: event,
        from: sourcesOf(event, input.source),
        start: start.at,
        ...(ends ? { end: ends.at } : {}),
        allDay,
        date: start.date,
        clock: allDay
          ? "All day"
          : ends
            ? `${start.clock}–${ends.clock}`
            : start.clock!,
      });
    }
    if (!read.length) return { error: NOTHING };
    // A day's all-day events come first, then its timed ones in order.
    const sorted = merged(read).sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.allDay) - Number(a.allDay) ||
        a.start - b.start,
    );
    left = sorted.length - Math.min(sorted.length, MAX_CARD_ITEMS);
    // Only events that are shown count towards sources and dropped links.
    const kept: TimedEvent[] = sorted.slice(0, MAX_CARD_ITEMS).map((event) => ({
      kind: "event",
      ...item(event.input, event.from, tally),
      start: event.start,
      ...(event.end === undefined ? {} : { end: event.end }),
      ...(event.allDay ? { allDay: true as const } : {}),
      date: event.date,
      clock: event.clock,
    }));
    markOverlaps(kept);
    const several = tally.sources.length > 1;
    const days = new Set(kept.map((e) => e.date)).size > 1;
    const items: CardTimelineItem[] = [];
    let date = "";
    // Free time runs from the latest end so far, across midnight too, and
    // is only named between two events of one day. After an event with no
    // end, nobody knows when free time starts.
    let busyUntil = Number.NEGATIVE_INFINITY;
    let timedToday = false;
    let openEnded = false;
    for (const event of kept) {
      if (event.date !== date) {
        date = event.date;
        timedToday = false;
        if (days) {
          items.push({ kind: "day", date });
          body.push("", date);
        }
      }
      if (!event.allDay) {
        if (timedToday && !openEnded && event.start - busyUntil >= MIN_GAP_MS)
          items.push({ kind: "gap", start: busyUntil, end: event.start });
        busyUntil = Math.max(busyUntil, event.end ?? event.start);
        openEnded = event.end === undefined;
        timedToday = true;
      }
      const { positions, date: _date, clock, ...rest } = event;
      items.push(withSources({ ...rest, positions }, several));
      body.push(line(clock, rest, tally.sources, positions));
    }
    shape = { type: "timeline", items };
  }

  if (left > 0) {
    more ??= { label: `and ${left} more` };
    notes.push(
      `Only the first ${MAX_CARD_ITEMS} were shown; ${left === 1 ? "1 was" : `${left} were`} left out.`,
    );
  }
  if (tally.droppedLinks)
    notes.push(
      `${tally.droppedLinks} ${tally.droppedLinks === 1 ? "link was" : "links were"} left out: a link must be a full http or https address.`,
    );
  const card: Card = {
    title,
    ...(url ? { url } : {}),
    sources: tally.sources,
    ...(warning ? { warning } : {}),
    ...(stats.length ? { stats } : {}),
    ...(more ? { more } : {}),
    ...shape,
  };
  const head = [
    `${title}${tally.sources.length === 1 ? ` (${tally.sources[0]})` : ""}${suffix(url)}`,
    ...(stats.length
      ? [stats.map((s) => `${s.value} ${s.label}`).join(" · ")]
      : []),
    ...(warning ? [`Note: ${warning}`] : []),
  ];
  // A list without group labels follows its heading directly.
  const lines = [...head, ...(body[0] === "" ? body : ["", ...body])];
  if (more) lines.push("", `${more.label}${suffix(more.url)}`);
  return { card, text: lines.join("\n"), notes };
}

/** What the bot reads back from its `show_card` call. */
export function cardResult(notes: string[], drawn: boolean) {
  return [
    drawn
      ? "The card is shown to the owner under your reply."
      : "The card is added to your reply as a plain list, because this chat cannot draw cards.",
    "Do not repeat its rows in your reply: write one or two sentences with what matters most.",
    ...notes,
  ].join(" ");
}
