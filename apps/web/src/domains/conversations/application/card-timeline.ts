import type { CardEvent, CardTimelineItem } from "@raphie/contracts";

/** One line of a timeline card as it reads at `now`. */
export type TimelineRow =
  | { kind: "day"; date: string }
  /** Where the present falls among today's events. */
  | { kind: "now"; at: number }
  | { kind: "gap"; start: number; end: number; current: boolean; past: boolean }
  | { kind: "event"; event: CardEvent; past: boolean };

/** The calendar date of `at` on this device, as YYYY-MM-DD. */
function localDate(at: number) {
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * A timeline's items with the present placed among them: what is over is
 * marked past, and a line for now goes before the first of today's events
 * still to end, or before the free time now falls in.
 */
export function timelineRows(
  items: CardTimelineItem[],
  now: number,
): TimelineRow[] {
  const today = localDate(now);
  const rows: TimelineRow[] = [];
  let placed = false;
  for (const item of items) {
    if (item.kind === "day") rows.push(item);
    else if (item.kind === "gap") {
      const current = item.start <= now && now < item.end;
      if (current && !placed) {
        rows.push({ kind: "now", at: now });
        placed = true;
      }
      rows.push({ ...item, current, past: item.end <= now });
    } else if (item.allDay)
      // An all-day event's start is midnight UTC of its date.
      rows.push({
        kind: "event",
        event: item,
        past: new Date(item.start).toISOString().slice(0, 10) < today,
      });
    else {
      const ends = item.end ?? item.start;
      if (!placed && ends > now && localDate(item.start) === today) {
        rows.push({ kind: "now", at: now });
        placed = true;
      }
      rows.push({ kind: "event", event: item, past: ends <= now });
    }
  }
  return rows;
}
