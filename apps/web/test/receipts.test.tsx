import { expect, test } from "bun:test";

import type { BackgroundRequest, SessionAsk } from "@raphie/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { placeReceipts } from "../src/domains/conversations/application/receipts";
import { BackgroundMarkers } from "../src/domains/conversations/presentation/background-requests";

const ask = (id: string, patch: Partial<SessionAsk>) =>
  ({
    id,
    conversationId: "s-work",
    turnId: "t-work",
    question: "Which city first?",
    options: [{ label: "Lisbon" }, { label: "Porto" }],
    createdAt: 100,
    expiresAt: 10_000,
    status: "answered",
    settledAt: null,
    answer: { choice: 1 },
    answeredVia: "web",
    ...patch,
  }) as SessionAsk;

const request = (asks: SessionAsk[]): BackgroundRequest => ({
  itemId: "w-6",
  title: "Venue research",
  sessionId: "s-work",
  toolApprovals: [],
  asks,
});

test("a receipt sits above the first message after it was settled", () => {
  const { above, last } = placeReceipts(
    [
      request([
        ask("late", { settledAt: 900 }),
        ask("early", { settledAt: 250 }),
        ask("waiting", { status: "pending", answer: null }),
      ]),
    ],
    [
      { id: "t1", at: 200 },
      { id: "t1:reply", at: 200 },
      { id: "t2", at: 300 },
      { id: "t2:reply", at: 300 },
    ],
  );
  expect([...above].map(([id, r]) => [id, r.map((x) => x.ask.id)])).toEqual([
    ["t2", ["early"]],
  ]);
  // Settled after the last message: at the end. A waiting one is no receipt.
  expect(last.map((r) => r.ask.id)).toEqual(["late"]);
});

test("the end of the chat marks only what still waits", () => {
  const settled = [request([ask("done", { settledAt: 250 })])];
  expect(renderToStaticMarkup(<BackgroundMarkers requests={settled} />)).toBe(
    "",
  );
  const waiting = [request([ask("open", { status: "pending", answer: null })])];
  expect(
    renderToStaticMarkup(<BackgroundMarkers requests={waiting} />),
  ).toContain("Venue research asked you something");
});
