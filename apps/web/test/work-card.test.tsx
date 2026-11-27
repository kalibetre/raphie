import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { NeedsYouCard } from "../src/domains/conversations/presentation/work-card";

test("background work that needs the owner names its item, says so and holds the controls", () => {
  const html = renderToStaticMarkup(
    <NeedsYouCard title="Clean up invoices" onOpenItem={() => {}}>
      <button type="button">Archive</button>
    </NeedsYouCard>,
  );
  for (const text of [
    'aria-label="Background work: Clean up invoices"',
    "Clean up invoices",
    "Needs you",
    "Archive",
    "Open item",
  ])
    expect(html).toContain(text);
});
