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

type Moment = { at: number; date: string; clock?: string };

/**
 * When an event starts or ends. The date and time of day are kept as
 * written, in the calendar's own zone, so a day's events stay together
 * wherever the runtime runs.
 */
function moment(value: string): Moment | null {
  const match = MOMENT.exec(value.trim());
  if (!match) return null;
  const at = Date.parse(match[2] ? value.trim() : `${match[1]}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return { at, date: match[1]!, ...(match[2] ? { clock: match[2] } : {}) };
}

type Tally = { sources: string[]; droppedLinks: number };

/** The parts every row and event share, with unsafe links left out. */
function item(input: ItemInput, fallbackSource: string | undefined, t: Tally) {
  const url = safeUrl(input.url);
  const linkUrl = safeUrl(input.link?.url);
  if (input.url && !url) t.droppedLinks++;
  if (input.link && !linkUrl) t.droppedLinks++;
  const source = (input.source ?? fallbackSource)?.trim();
  let position: number | undefined;
  if (source) {
    position = t.sources.indexOf(source);
    if (position < 0) position = t.sources.push(source) - 1;
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
    position,
  };
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

type TimedEvent = Placed<CardEvent> & { date: string; clock: string };

/** The same event read from two calendars is one event from both. */
function merged(events: TimedEvent[]) {
  const seen = new Map<string, TimedEvent>();
  for (const event of events) {
    const key = [
      event.title.toLowerCase(),
      event.start,
      event.end ?? "",
      event.allDay ?? "",
    ].join("|");
    const first = seen.get(key);
    if (!first) {
      seen.set(key, event);
      continue;
    }
    for (const position of event.positions)
      if (!first.positions.includes(position)) first.positions.push(position);
    first.url ??= event.url;
    first.link ??= event.link;
    first.detail ??= event.detail;
    first.badge ??= event.badge;
  }
  return [...seen.values()];
}

/** Marks timed events that share time with another, unless the bot badged them. */
function markOverlaps(events: TimedEvent[]) {
  const timed = events.filter((e) => !e.allDay && e.end !== undefined);
  for (const event of timed)
    if (
      !event.badge &&
      timed.some(
        (other) =>
          other !== event &&
          other.start < event.end! &&
          event.start < other.end!,
      )
    )
      event.badge = { label: "Overlaps", tone: "attention" };
}

/**
 * A bot's `show_card` arguments as the card clients draw and the text chats
 * read. Links that are not http or https are left out, the same event from
 * two sources is shown once, and events that share time are marked.
 */
export function buildCard(input: CardInput): BuiltCard {
  const hasGroups = !!input.groups?.length;
  const hasEvents = !!input.events?.length;
  if (hasGroups === hasEvents)
    return {
      error: hasGroups
        ? "Pass groups for a list or events for a timeline, not both."
        : "A card needs at least one row or event. When there is nothing to list, say so in your reply instead.",
    };
  const tally: Tally = { sources: [], droppedLinks: 0 };
  const notes: string[] = [];
  const title = input.title.trim();
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
      const rows = group.rows.slice(0, room).map((row) => {
        const { position, ...rest } = item(row, input.source, tally);
        return {
          ...(row.key?.trim() ? { key: row.key.trim() } : {}),
          ...rest,
          ...(row.trailing?.trim() ? { trailing: row.trailing.trim() } : {}),
          positions: position === undefined ? [] : [position],
        };
      });
      left += group.rows.length - rows.length;
      room -= rows.length;
      if (rows.length)
        groups.push({
          ...(group.label?.trim() ? { label: group.label.trim() } : {}),
          rows,
        });
    }
    if (!groups.length)
      return {
        error:
          "A card needs at least one row. When there is nothing to list, say so in your reply instead.",
      };
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
    const events: TimedEvent[] = [];
    for (const [index, event] of input.events!.entries()) {
      const start = moment(event.start);
      const end = event.end ? moment(event.end) : undefined;
      if (!start || end === null)
        return {
          error: `Event ${index + 1} ("${event.title}") has a time I cannot read. Give start and end as a date ("2026-11-23") for an all-day event, or a date and time with its UTC offset ("2026-11-23T14:00:00+03:00").`,
        };
      const allDay = !start.clock;
      const { position, ...rest } = item(event, input.source, tally);
      events.push({
        kind: "event",
        ...rest,
        start: start.at,
        ...(!allDay && end && end.at > start.at ? { end: end.at } : {}),
        ...(allDay ? { allDay: true as const } : {}),
        positions: position === undefined ? [] : [position],
        date: start.date,
        clock: allDay
          ? "All day"
          : end?.clock && end.at > start.at
            ? `${start.clock}–${end.clock}`
            : start.clock!,
      });
    }
    // A day's all-day events come first, then its timed ones in order.
    const sorted = merged(events).sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(!!b.allDay) - Number(!!a.allDay) ||
        a.start - b.start,
    );
    const kept = sorted.slice(0, MAX_CARD_ITEMS);
    left = sorted.length - kept.length;
    markOverlaps(kept);
    const several = tally.sources.length > 1;
    const days = new Set(kept.map((e) => e.date)).size > 1;
    const items: CardTimelineItem[] = [];
    let date = "";
    let busyUntil: number | undefined;
    for (const event of kept) {
      if (event.date !== date) {
        date = event.date;
        busyUntil = undefined;
        if (days) {
          items.push({ kind: "day", at: event.start });
          body.push("", date);
        }
      }
      if (!event.allDay) {
        if (busyUntil !== undefined && event.start - busyUntil >= MIN_GAP_MS)
          items.push({ kind: "gap", start: busyUntil, end: event.start });
        busyUntil = Math.max(busyUntil ?? 0, event.end ?? event.start);
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
      `Only the first ${MAX_CARD_ITEMS} were shown; ${left} were left out.`,
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
