import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { WorkCard } from "../src/domains/conversations/presentation/work-card";

const at = Date.UTC(2026, 10, 27, 12, 39);

test("background work's result: its title and time, folded text and the item's actions", () => {
  const html = renderToStaticMarkup(
    <WorkCard
      kind="background"
      title="Tidy the reports folder"
      at={at}
      text={<p>Deleted 214 newsletters.</p>}
      onQuote={() => {}}
      onOpenItem={() => {}}
    >
      <p>A step</p>
    </WorkCard>,
  );
  for (const text of [
    'aria-label="Background work: Tidy the reports folder"',
    "Background work",
    "Tidy the reports folder",
    "Deleted 214 newsletters.",
    "A step",
    "Quote",
    "Open item",
  ])
    expect(html).toContain(text);
  // A run that simply finished has no badge and no item id, only its time.
  expect(html).not.toContain("data-status");
  expect(html).not.toContain("w-6");
  expect(html).toMatch(/<header[^]*<time/);
  // The text folds; what follows it does not.
  expect(html).toMatch(/data-folded="true"[^>]*><p>Deleted 214/);
  expect(html).not.toMatch(/data-folded="true"[^>]*><p>A step/);
});

test("a scheduled job's post has its time in the header and no status", () => {
  const html = renderToStaticMarkup(
    <WorkCard
      kind="scheduled"
      title="Morning brief"
      at={at}
      hint="Saved instruction: Summarise today"
      text={<p>Good morning.</p>}
    />,
  );
  expect(html).toContain("Scheduled");
  expect(html).toContain('title="Saved instruction: Summarise today"');
  expect(html).not.toContain("data-status");
  expect(html).toMatch(/<header[^]*<time/);
  expect(html).not.toContain("<footer");
});

test("background work that needs the owner says so and keeps its controls unfolded", () => {
  const html = renderToStaticMarkup(
    <WorkCard kind="background" title="Clean up invoices" status="needs-you">
      <button type="button">Archive</button>
    </WorkCard>,
  );
  expect(html).toContain("Needs you");
  expect(html).toContain('data-status="needs-you"');
  expect(html).not.toContain("data-folded");
});
