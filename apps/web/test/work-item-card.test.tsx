import { expect, test } from "bun:test";

import type { WorkItem } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkItemCard } from "../src/domains/settings/presentation/work-item-card";

const item: WorkItem = {
  id: "w-3",
  title: "Flights to Lisbon",
  status: "waiting",
  waitingOn: "you to pick a date",
  notes: "Two options found.",
  result: { text: "Sent both options", at: Date.UTC(2026, 10, 25, 9) },
  opened: { at: Date.UTC(2026, 10, 24, 9), by: "bot" },
  updatedAt: Date.UTC(2026, 10, 25, 9),
};

const render = (each: WorkItem) =>
  renderToStaticMarkup(
    <WorkItemCard
      item={each}
      bot="Raphie"
      pending={false}
      onEdit={() => {}}
      onChange={() => {}}
      onCancel={() => {}}
    />,
  );

test("an open item says what it waits on and can be finished, edited or dropped", () => {
  const html = render(item);
  for (const text of [
    "Flights to Lisbon",
    "Waiting",
    "Waiting on you to pick a date",
    "Two options found.",
    "Sent both options",
    "w-3 · Opened by Raphie",
    "Mark done",
    "Edit",
    "Drop",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Reopen");
});

test("a closed item says who closed it and can only be reopened", () => {
  const html = render({
    ...item,
    status: "dropped",
    waitingOn: undefined,
    closed: { at: Date.UTC(2026, 10, 26, 9), by: "owner" },
  });
  expect(html).toContain("Dropped by you");
  expect(html).toContain("Reopen");
  expect(html).not.toContain("Waiting on");
  expect(html).not.toContain("Mark done");
});

test("a running item says so and can be cancelled", () => {
  const html = render({
    ...item,
    status: "active",
    waitingOn: undefined,
    run: { startedAt: Date.UTC(2026, 10, 26, 9), turnId: "t-9" },
  });
  expect(html).toContain("Working");
  expect(html).toContain("Cancel run");
});

test("an item at rest has nothing to cancel", () => {
  expect(render(item)).not.toContain("Cancel run");
});
