import { expect, test } from "bun:test";

import type { SessionApproval, SessionAsk } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { dockItems } from "../src/domains/conversations/application/dock";
import { AskMarker } from "../src/domains/conversations/presentation/ask-marker";
import {
  waitingLine,
  waitingOnOwner,
} from "../src/domains/settings/application/team-presence";

const now = Date.UTC(2026, 10, 27, 12);

const ask = (id: string, at: number, patch: Partial<SessionAsk> = {}) =>
  ({
    id,
    conversationId: "chat",
    turnId: "t",
    question: "Which one?",
    options: [{ label: "Tue" }, { label: "Wed" }],
    createdAt: at,
    expiresAt: now + 60_000,
    status: "pending",
    answer: null,
    answeredVia: null,
    ...patch,
  }) as SessionAsk;

const approval = (
  id: string,
  at: number,
  patch: Partial<SessionApproval> = {},
) =>
  ({
    id,
    conversationId: "chat",
    server: "workspace",
    tool: "bash",
    argumentsJson: "{}",
    createdAt: at,
    expiresAt: now + 60_000,
    status: "pending",
    decidedVia: null,
    execution: "waiting",
    ...patch,
  }) as unknown as SessionApproval;

test("the dock holds every open question and approval, the chat's and its background work's, oldest first", () => {
  const items = dockItems(
    {
      asks: [
        ask("a-chat", 3),
        ask("a-done", 1, { status: "answered" }),
        ask("a-other", 0, { conversationId: "other" }),
      ],
      toolApprovals: [
        approval("p-chat", 2),
        approval("p-old", 1, { expiresAt: now - 1 }),
      ],
      background: [
        {
          itemId: "w-6",
          title: "Tidy the reports folder",
          sessionId: "s-6",
          asks: [ask("a-bg", 1, { conversationId: "s-6" })],
          toolApprovals: [],
        },
      ],
    },
    "chat",
    "Raphie",
    now,
  );
  expect(items.map((i) => [i.id, i.kind, i.title, i.itemId])).toEqual([
    ["a-bg", "question", "Tidy the reports folder", "w-6"],
    ["p-chat", "approval", "Raphie", undefined],
    ["a-chat", "question", "Raphie", undefined],
  ]);
});

test("a question waiting reads as a marker, then as a receipt of the answer", () => {
  expect(
    renderToStaticMarkup(<AskMarker ask={ask("a", now)} title="Raphie" />),
  ).toContain("Raphie asked you something");
  const picked = renderToStaticMarkup(
    <AskMarker
      ask={ask("a", now, { status: "answered", answer: { choice: 1 } })}
      title="Raphie"
    />,
  );
  expect(picked).toContain("You answered");
  expect(picked).toContain(">Wed</strong>");
  const typed = renderToStaticMarkup(
    <AskMarker
      ask={ask("a", now, { status: "answered", answer: { text: "keep them" } })}
      title="Tidy the reports folder"
    />,
  );
  expect(typed).toContain("“keep them”");
  expect(typed).toContain("Tidy the reports folder");
});

test("the sidebar counts what a teammate waits on and opens its chat", () => {
  const session = (patch: object) =>
    ({ id: "x", sessionId: "x", lastAt: 1, waiting: false, ...patch }) as never;
  const waiting = waitingOnOwner([
    session({ id: "chat", sessionId: "chat", chat: true }),
    session({ id: "w", sessionId: "w", waiting: true, pending: 2, lastAt: 5 }),
    session({ id: "v", sessionId: "v", asking: true, lastAt: 3 }),
  ])!;
  expect(waiting.count).toBe(3);
  expect(waiting.session.sessionId).toBe("chat");
  expect(waitingLine("Raphie", waiting.count, waiting.asking)).toBe(
    "Raphie has 3 questions",
  );
  expect(waitingLine("Raphie", 1, false)).toBe("Raphie needs your OK");
  expect(waitingOnOwner([session({})])).toBeUndefined();
});
