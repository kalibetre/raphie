import { expect, test } from "bun:test";

import type { SessionApproval, SessionAsk } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import {
  arrangeDock,
  dockItems,
  dockLine,
  foldDock,
  openDock,
  settleDock,
  skipTop,
  unfoldDock,
} from "../src/domains/conversations/application/dock";
import { AskMarker } from "../src/domains/conversations/presentation/ask-marker";
import { QuestionDock } from "../src/domains/conversations/presentation/question-dock";
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
    ({
      id: "x",
      sessionId: "x",
      title: "Untitled",
      lastAt: 1,
      waiting: false,
      pending: 0,
      ...patch,
    }) as never;
  const waiting = waitingOnOwner([
    session({ id: "chat", sessionId: "chat", chat: true }),
    session({
      id: "w",
      sessionId: "w",
      work: "w-6",
      waiting: true,
      pending: 2,
      lastAt: 5,
    }),
    session({
      id: "v",
      sessionId: "v",
      work: "w-7",
      asking: true,
      pending: 1,
      lastAt: 3,
    }),
  ])!;
  expect(waiting.count).toBe(3);
  // Everything waits in the chat or a work item's session: the chat's dock.
  expect(waiting.session.sessionId).toBe("chat");
  expect(waiting.title).toBe("Untitled");
  expect(waitingLine("Raphie", waiting.count, waiting.asking)).toBe(
    "Raphie has 3 questions",
  );
  expect(waitingLine("Raphie", 1, false)).toBe("Raphie needs your OK");
  // A group's approval isn't in the chat's dock: the sidebar opens the group.
  const group = waitingOnOwner([
    session({ id: "chat", sessionId: "chat", chat: true }),
    session({
      id: "g",
      sessionId: "g",
      title: "Team group",
      waiting: true,
      pending: 1,
      lastAt: 9,
    }),
  ])!;
  expect(group.session.sessionId).toBe("g");
  expect(group.title).toBe("Team group");
  expect(waitingOnOwner([session({})])).toBeUndefined();
});

const items = (ids: string[]) =>
  dockItems(
    {
      asks: ids.map((id, i) => ask(id, i)),
      toolApprovals: [],
      background: [],
    },
    "chat",
    "Raphie",
    now,
  );

test("skipping sends the top item to the back, in the order skipped", () => {
  const all = items(["a", "b", "c"]);
  let view = openDock;
  view = skipTop(view, arrangeDock(all, view).items);
  expect(arrangeDock(all, view).items.map((i) => i.id)).toEqual([
    "b",
    "c",
    "a",
  ]);
  view = skipTop(view, arrangeDock(all, view).items);
  expect(arrangeDock(all, view).items.map((i) => i.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
  // A lone item has nowhere to go.
  expect(skipTop(openDock, items(["a"]))).toBe(openDock);
});

test("a folded dock stays folded until something new arrives", () => {
  const two = items(["a", "b"]);
  const view = foldDock(openDock, two);
  expect(arrangeDock(two, view).folded).toBe(true);
  // Answering one keeps it folded.
  expect(arrangeDock(items(["b"]), view).folded).toBe(true);
  // A new question opens it, on top, for good: what was folded waits
  // behind it, and answering the new one does not fold it again.
  const three = items(["a", "b", "c"]);
  expect(arrangeDock(three, view).folded).toBe(false);
  const settled = settleDock(view, three)!;
  expect(arrangeDock(three, settled).items.map((i) => i.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(arrangeDock(two, settled).folded).toBe(false);
  expect(settleDock(view, two)).toBeUndefined();
  expect(arrangeDock(two, unfoldDock(view)).folded).toBe(false);
});

test("the folded bar counts what waits and names the top item", () => {
  const html = renderToStaticMarkup(
    <QuestionDock items={items(["a", "b"])} folded />,
  );
  expect(html).toContain("2 waiting");
  expect(html).toContain("Which one?");
  expect(html).toContain('aria-expanded="false"');
  expect(
    dockLine({
      ...items(["a"])[0]!,
      ask: undefined,
      approval: approval("p", 0),
    }),
  ).toBe("Run bash on workspace?");
});
