import { expect, test } from "bun:test";

import type { SessionTurn } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkTab } from "../src/domains/conversations/presentation/work-tab";

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
  expect(html).toContain("<strong>Venue research</strong>");
  expect(html).toContain("“look into venues for the offsite”");
  expect(html).toContain(">Failed</span>");
  expect(html).not.toContain("w-2");
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
  expect(html).not.toContain(" · ");
  expect(html).toContain(">Cancelled</span>");
});
