import { expect, test } from "bun:test";

import type { CardTimelineItem } from "@raphie/contracts";

import {
  duration,
  schedule,
} from "../src/domains/conversations/application/card-schedule";

// Local times, so the day is the same wherever the tests run.
const at = (hour: number, minute = 0, day = 23) =>
  new Date(2026, 10, day, hour, minute).getTime();

const event = (
  title: string,
  start: number,
  end?: number,
  sources?: number[],
) => ({
  kind: "event" as const,
  title,
  start,
  ...(end ? { end } : {}),
  ...(sources ? { sources } : {}),
});

const standup = event("Standup", at(9, 30), at(9, 45));
const sync = event("Sync", at(11), at(12));
const dentist = event("Dentist", at(11, 45), at(12, 30), [1]);
const interview = event("Interview", at(14, 30), at(15, 30));
const birthday = {
  kind: "event" as const,
  title: "Birthday",
  start: Date.UTC(2026, 10, 23),
  allDay: true as const,
};
const today: CardTimelineItem[] = [
  birthday,
  standup,
  { kind: "gap", start: at(9, 45), end: at(11) },
  sync,
  dentist,
  { kind: "gap", start: at(12, 30), end: at(14, 30) },
  interview,
];

const titles = (rows: ReturnType<typeof schedule>[number]["rows"]) =>
  rows.map((row) => (row.kind === "event" ? row.event.title : `${row.kind}`));

test("today reads its date from the events, counts each once and folds what is over", () => {
  const [day, ...rest] = schedule(today, at(10, 42));
  expect(rest).toEqual([]);
  expect(day!.date).toBe("2026-11-23");
  expect(day!.offset).toBe(0);
  expect(day!.events).toBe(5);
  expect(day!.allDay).toEqual([birthday]);
  // 15m + 11:00–12:30 with the overlap once + 1h.
  expect(duration(day!.booked)).toBe("2h 45m");
  expect(day!.freeAfter).toBe(at(15, 30));
  expect(day!.earlier.map((e) => e.title)).toEqual(["Standup"]);
  expect(titles(day!.rows)).toEqual([
    "now",
    "gap",
    "Sync",
    "Dentist",
    "gap",
    "Interview",
  ]);
  expect(day!.next).toEqual({ event: sync, current: false });
});

test("during an event it is what is on now", () => {
  const [day] = schedule(today, at(11, 50));
  expect(day!.next).toEqual({ event: sync, current: true });
  expect(day!.earlier.map((e) => e.title)).toEqual(["Standup"]);
});

test("once the day is over nothing is folded, nothing is next and it is not free after", () => {
  const [day] = schedule(today, at(18));
  expect(day!.earlier).toEqual([]);
  expect(day!.next).toBeUndefined();
  expect(day!.freeAfter).toBeUndefined();
  expect(titles(day!.rows)).toEqual([
    "Standup",
    "gap",
    "Sync",
    "Dentist",
    "gap",
    "Interview",
  ]);
});

test("the strip covers a working day at least, with overlaps on a second lane", () => {
  const strip = schedule(today, at(10, 42))[0]!.strip!;
  expect(strip.from).toBe(at(8));
  expect(strip.to).toBe(at(18));
  expect(strip.hours).toEqual([at(8), at(12), at(15), at(18)]);
  expect(strip.now).toBe(at(10, 42));
  expect(strip.blocks.map((b) => [b.lane, b.split, b.source, b.past])).toEqual([
    [0, false, 0, true],
    [0, true, 0, false],
    [1, true, 1, false],
    [0, false, 0, false],
  ]);
  // An evening event widens it to the next whole hour.
  const late = schedule([event("Dinner", at(19, 30), at(20, 15))], at(9));
  expect(late[0]!.strip!.to).toBe(at(21));
  // An hour too close to the end is not labelled beside it.
  const later = schedule([event("Dinner", at(21, 30), at(22, 15))], at(9));
  expect(later[0]!.strip!.hours).toEqual([
    at(8),
    at(12),
    at(15),
    at(18),
    at(23),
  ]);
});

test("another day has no strip, nothing next and nothing folded", () => {
  const [day] = schedule(today, at(10, 0, 22));
  expect(day!.offset).toBe(1);
  expect(day!.strip).toBeUndefined();
  expect(day!.next).toBeUndefined();
  expect(day!.earlier).toEqual([]);
  expect(day!.freeAfter).toBe(at(15, 30));
});

test("several days split on their day lines", () => {
  const days = schedule(
    [
      { kind: "day", date: "2026-11-23" },
      standup,
      { kind: "day", date: "2026-11-24" },
      event("Planning", at(16, 0, 24), at(17, 0, 24)),
    ],
    at(8),
  );
  expect(days.map((d) => [d.date, d.offset, d.events])).toEqual([
    ["2026-11-23", 0, 1],
    ["2026-11-24", 1, 1],
  ]);
});

test("an event with no end leaves the free time unknown", () => {
  const [day] = schedule([standup, event("Call", at(16))], at(8));
  expect(day!.freeAfter).toBeUndefined();
  expect(duration(day!.booked)).toBe("15m");
});

test("a length reads in hours and minutes", () => {
  expect(duration(45 * 60_000)).toBe("45m");
  expect(duration(2 * 3_600_000)).toBe("2h");
  expect(duration(225 * 60_000)).toBe("3h 45m");
  expect(duration(10_000)).toBe("1m");
});
