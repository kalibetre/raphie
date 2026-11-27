import { expect, test } from "bun:test";

import type { SessionTurn } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkTab } from "../src/domains/conversations/presentation/work-tab";

/** The tab's visible text, without its tooltip. */
const visible = (html: string) =>
  /class="work-tab-text">(.*?)<\/span><span class="work-tab-stamp"/.exec(
    html,
  )?.[1] ?? "";

const turn = (patch: Partial<SessionTurn>): SessionTurn =>
  ({
    id: "t-1",
    conversationId: 1,
    source: "web",
    text: "",
    createdAt: 0,
    status: "done",
    answer: "Three venues are free.",
    ...patch,
  }) as SessionTurn;

test("background work's result names its item, quotes the request and stamps how it ended", () => {
  const html = renderToStaticMarkup(
    <WorkTab
      turn={turn({
        work: {
          itemId: "w-2",
          title: "Venue research",
          kind: "result",
          outcome: "failed",
          request: "look into venues for the offsite",
        },
      })}
    />,
  );
  expect(html).toContain('data-outcome="failed"');
  expect(html).toContain(">Venue research</strong>");
  expect(html).toContain("“look into venues for the offsite”");
  expect(html).toContain("Run </span>Failed</span>");
  // The id is in the tooltip only, not the text.
  expect(html).toContain('title="w-2 · Venue research');
  expect(visible(html)).not.toContain("w-2");
});

test("a scheduled job's post says it was scheduled", () => {
  const html = renderToStaticMarkup(
    <WorkTab
      turn={turn({
        scheduled: { name: "Morning brief" },
        work: {
          itemId: "w-4",
          title: "Morning brief",
          kind: "result",
          outcome: "completed",
        },
      })}
    />,
  );
  expect(html).toContain('data-outcome="completed"');
  expect(html).toContain(" · scheduled");
  expect(html).toContain(">Done</span>");
});

test("a result without a request quotes nothing", () => {
  const html = renderToStaticMarkup(
    <WorkTab
      turn={turn({
        work: {
          itemId: "w-3",
          title: "Catering",
          kind: "result",
          outcome: "cancelled",
        },
      })}
    />,
  );
  expect(visible(html)).not.toContain(" · ");
  expect(html).toContain(">Cancelled</span>");
});

test("a message still being written names its work but stamps nothing yet", () => {
  const html = renderToStaticMarkup(
    <WorkTab
      turn={turn({
        status: "pending",
        answer: null,
        scheduled: { name: "Morning brief" },
      })}
    />,
  );
  expect(html).toContain("Morning brief");
  expect(html).not.toContain("work-tab-stamp");
  expect(html).not.toContain("data-outcome");
});

test("with a way to open its item, the tab is a button that says so", () => {
  const html = renderToStaticMarkup(
    <WorkTab
      onOpen={() => {}}
      turn={turn({
        work: { itemId: "w-2", title: "Venue research", kind: "result" },
      })}
    />,
  );
  expect(html).toMatch(/^<button type="button" class="work-tab work-tab-link"/);
  expect(html).toContain('title="Open w-2 · Venue research"');
});
