import type {
  Card,
  CardBadge,
  CardColor,
  CardColumn,
  CardEvent,
  CardField,
  CardGroup,
  CardLink,
  CardRow,
  CardSteps,
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
  badge?: BadgeInput;
  link?: { label: string; url: string };
  source?: string;
};

type BadgeInput = { label: string; tone?: CardTone };

export type RowInput = ItemInput & {
  key?: string;
  trailing?: string;
  people?: string[];
  tags?: string[];
  progress?: { done: number; total: number };
  due?: string;
};

export type FieldInput = {
  label: string;
  value?: string;
  badge?: BadgeInput;
  people?: string[];
  tags?: string[];
  due?: string;
};

/** Rows one column of a board shows; its count says how many it holds. */
export const MAX_COLUMN_ROWS = 10;

/** Steps of an item's checklist a card lists; the rest are only counted. */
export const MAX_ITEM_STEPS = 5;

/** How much of an item's description a card shows. */
const MAX_BODY_LENGTH = 600;

/** Colours given in turn to columns the bot did not colour. */
const COLUMN_COLORS: CardColor[] = [
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "red",
];

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
  columns?: {
    label?: string;
    color?: CardColor;
    count?: number;
    rows: RowInput[];
  }[];
  item?: {
    key?: string;
    fields?: FieldInput[];
    body?: string;
    steps?: { label: string; done?: boolean }[];
  };
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

type Tally = {
  sources: string[];
  droppedLinks: number;
  droppedDates: number;
  timeZone?: string;
};

const badgeOf = (badge: BadgeInput | undefined): CardBadge | undefined =>
  badge?.label.trim()
    ? { label: badge.label.trim(), tone: badge.tone ?? "neutral" }
    : undefined;

/** Names or tags, trimmed, without blanks or repeats. */
function names(values: string[] | undefined, most: number) {
  const kept = [
    ...new Set((values ?? []).map((v) => v.trim()).filter(Boolean)),
  ].slice(0, most);
  return kept.length ? kept : undefined;
}

/** The day something is due, on the owner's calendar when their zone is known. */
function dueDate(value: string | undefined, t: Tally) {
  if (!value?.trim()) return undefined;
  const read = moment(value, t.timeZone);
  if (!read) t.droppedDates++;
  return read?.date;
}

/** What a row and an item's field can both carry beyond text. */
function facts(
  input: Pick<RowInput, "people" | "tags" | "due">,
  t: Tally,
): Pick<CardRow, "people" | "tags" | "due"> {
  const people = names(input.people, 4);
  const tags = names(input.tags, 4);
  const due = dueDate(input.due, t);
  return {
    ...(people ? { people } : {}),
    ...(tags ? { tags } : {}),
    ...(due ? { due } : {}),
  };
}

/** One row of a list or a board. */
function row(input: RowInput, fallbackSource: string | undefined, t: Tally) {
  const total = Math.trunc(input.progress?.total ?? 0);
  const done = Math.min(
    total,
    Math.max(0, Math.trunc(input.progress?.done ?? 0)),
  );
  return {
    ...(input.key?.trim() ? { key: input.key.trim() } : {}),
    ...item(input, sourcesOf(input, fallbackSource), t),
    ...(input.trailing?.trim() ? { trailing: input.trailing.trim() } : {}),
    ...facts(input, t),
    ...(total > 0 ? { progress: { done, total } } : {}),
  };
}

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
  const badge = badgeOf(input.badge);
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
    it.due && `due ${it.due}`,
    it.progress && `${it.progress.done}/${it.progress.total} steps`,
    it.people?.join(", "),
    it.tags?.join(", "),
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
  const hasColumns = !!input.columns?.length;
  const kinds = [hasGroups, hasEvents, hasColumns, !!input.item].filter(
    Boolean,
  ).length;
  if (kinds > 1)
    return {
      error:
        "Pass one of groups for a list, events for a timeline, columns for a board or item for one task, not several.",
    };
  if (!kinds) return { error: NOTHING };
  const title = input.title.trim();
  if (!title) return { error: "A card needs a title." };
  const tally: Tally = {
    sources: [],
    droppedLinks: 0,
    droppedDates: 0,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  };
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
    | { type: "timeline"; items: CardTimelineItem[] }
    | { type: "board"; columns: CardColumn[] }
    | {
        type: "item";
        key?: string;
        fields: CardField[];
        body?: string;
        steps?: CardSteps;
      };
  let left = 0;

  if (hasGroups) {
    let room = MAX_CARD_ITEMS;
    const groups: { label?: string; rows: Placed<CardRow>[] }[] = [];
    for (const group of input.groups!) {
      const titled = group.rows.filter((row) => row.title.trim());
      // Only rows that are shown count towards sources and dropped links.
      const rows = titled
        .slice(0, room)
        .map((each) => row(each, input.source, tally));
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
  } else if (hasColumns) {
    const free = COLUMN_COLORS.filter(
      (color) => !input.columns!.some((column) => column.color === color),
    );
    let next = 0;
    const columns = input.columns!.map((column) => {
      const titled = column.rows.filter((each) => each.title.trim());
      const label = column.label?.trim();
      return {
        label: label || "No column",
        // A column without a name is the board's leftovers, in gray.
        color:
          column.color ??
          (label
            ? (free[next++ % Math.max(free.length, 1)] ?? "blue")
            : ("gray" as const)),
        count: Math.max(Math.trunc(column.count ?? 0), titled.length),
        rows: titled
          .slice(0, MAX_COLUMN_ROWS)
          .map((each) => row(each, input.source, tally)),
      };
    });
    if (!columns.some((column) => column.count > 0)) return { error: NOTHING };
    const several = tally.sources.length > 1;
    shape = {
      type: "board",
      columns: columns.map((column) => ({
        ...column,
        rows: column.rows.map((each) => withSources(each, several)),
      })),
    };
    for (const column of columns) {
      body.push("", `${column.label} (${column.count})`);
      for (const { positions, ...each } of column.rows)
        body.push(line(each.key ?? "", each, tally.sources, positions));
      if (column.count > column.rows.length)
        body.push(`…and ${column.count - column.rows.length} more`);
    }
  } else if (input.item) {
    const fields: CardField[] = [];
    for (const field of (input.item.fields ?? []).slice(0, 8)) {
      const label = field.label.trim();
      const value = field.value?.trim();
      const badge = badgeOf(field.badge);
      const rest = facts(field, tally);
      if (!label || (!value && !badge && !Object.keys(rest).length)) continue;
      fields.push({
        label,
        ...(value ? { value } : {}),
        ...(badge ? { badge } : {}),
        ...rest,
      });
    }
    const whole = input.item.body?.trim();
    const text =
      whole && whole.length > MAX_BODY_LENGTH
        ? `${whole.slice(0, MAX_BODY_LENGTH).trimEnd()}…`
        : whole;
    const listed = (input.item.steps ?? [])
      .map((step) => ({ label: step.label.trim(), done: !!step.done }))
      .filter((step) => step.label);
    const steps: CardSteps | undefined = listed.length
      ? {
          done: listed.filter((step) => step.done).length,
          total: listed.length,
          items: listed.slice(0, MAX_ITEM_STEPS).map((step) => ({
            label: step.label,
            ...(step.done ? { done: true as const } : {}),
          })),
        }
      : undefined;
    if (!fields.length && !text && !steps)
      return {
        error:
          "An item card needs fields, a body or steps. With only a title, say it in your reply instead.",
      };
    const key = input.item.key?.trim();
    if (input.source?.trim()) tally.sources.push(input.source.trim());
    shape = {
      type: "item",
      ...(key ? { key } : {}),
      fields,
      ...(text ? { body: text } : {}),
      ...(steps ? { steps } : {}),
    };
    for (const field of fields)
      body.push(
        `${field.label}: ${[
          field.value,
          field.badge?.label,
          field.due,
          field.people?.join(", "),
          field.tags?.join(", "),
        ]
          .filter(Boolean)
          .join(" · ")}`,
      );
    if (text) body.push("", text);
    if (steps) {
      body.push("", `Steps: ${steps.done} of ${steps.total}`);
      for (const step of steps.items)
        body.push(`${step.done ? "☑" : "☐"} ${step.label}`);
      if (steps.total > steps.items.length)
        body.push(`…and ${steps.total - steps.items.length} more`);
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
  if (tally.droppedDates)
    notes.push(
      `${tally.droppedDates === 1 ? "A due date was" : `${tally.droppedDates} due dates were`} left out: give a date as "2026-11-27".`,
    );
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
    `${shape.type === "item" && shape.key ? `${shape.key} ` : ""}${title}${tally.sources.length === 1 ? ` (${tally.sources[0]})` : ""}${suffix(url)}`,
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
