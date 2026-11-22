import { expect, test } from "bun:test";

import type { CardTimelineItem } from "@raphie/contracts";

import { timelineRows } from "../src/domains/conversations/application/card-timeline";

// Local times, so the day is the same wherever the tests run.
const at = (hour: number, minute = 0, day = 23) =>
  new Date(2026, 10, day, hour, minute).getTime();

const event = (title: string, start: number, end?: number) => ({
  kind: "event" as const,
  title,
  start,
  ...(end ? { end } : {}),
});

const standup = event("Standup", at(9, 30), at(9, 45));
const oneToOne = event("1:1", at(13), at(13, 30));
const planning = event("Planning", at(14), at(15));
const day: CardTimelineItem[] = [
  standup,
  { kind: "gap", start: at(9, 45), end: at(13) },
  oneToOne,
  { kind: "gap", start: at(13, 30), end: at(14) },
  planning,
];

const kinds = (now: number) =>
  timelineRows(day, now).map((row) =>
    row.kind === "event"
      ? `${row.event.title}${row.past ? " (past)" : ""}`
      : row.kind === "gap"
        ? `gap${row.current ? " (current)" : ""}${row.past ? " (past)" : ""}`
        : row.kind,
  );

test("before the day starts, now sits above the first event", () => {
  expect(kinds(at(8))).toEqual([
    "now",
    "Standup",
    "gap",
    "1:1",
    "gap",
    "Planning",
  ]);
});

test("in free time, now sits above the gap it falls in and what is over is past", () => {
  expect(kinds(at(10, 42))).toEqual([
    "Standup (past)",
    "now",
    "gap (current)",
    "1:1",
    "gap",
    "Planning",
  ]);
});

test("during an event, now sits above it", () => {
  expect(kinds(at(14, 20))).toEqual([
    "Standup (past)",
    "gap (past)",
    "1:1 (past)",
    "gap (past)",
    "now",
    "Planning",
  ]);
});

test("once the day is over, or on another day, there is no line for now", () => {
  const over = [
    "Standup (past)",
    "gap (past)",
    "1:1 (past)",
    "gap (past)",
    "Planning (past)",
  ];
  expect(kinds(at(18))).toEqual(over);
  expect(kinds(at(10, 0, 24))).toEqual(over);
  expect(kinds(at(10, 0, 22))).toEqual([
    "Standup",
    "gap",
    "1:1",
    "gap",
    "Planning",
  ]);
});

test("an all-day event is past only after its date, and days pass through", () => {
  const birthday = {
    kind: "event" as const,
    title: "Birthday",
    start: Date.UTC(2026, 10, 23),
    allDay: true as const,
  };
  const items: CardTimelineItem[] = [{ kind: "day", at: at(0) }, birthday];
  expect(timelineRows(items, at(23, 59))).toEqual([
    { kind: "day", at: at(0) },
    { kind: "event", event: birthday, past: false },
  ]);
  expect(timelineRows(items, at(0, 1, 24))[1]).toEqual({
    kind: "event",
    event: birthday,
    past: true,
  });
});
