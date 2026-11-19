import { expect, test } from "bun:test";

import type { Handoff } from "@raphie/contracts";

import {
  delegateGroups,
  delegateLabel,
  openHandoffs,
  requestsFromTurn,
  requestStatus,
} from "../src/domains/conversations/application/handoffs";

const handoff = (
  id: string,
  bot: string,
  patch: Partial<Handoff> = {},
): Handoff => ({
  id,
  to: { id: bot, name: bot[0]!.toUpperCase() + bot.slice(1) },
  title: id,
  fromSessionId: "s1",
  toSessionId: `${bot}-session`,
  status: "working",
  createdAt: 1,
  requests: [
    {
      brief: "Do it",
      fromTurnId: "t1",
      sentAt: 1,
      turnId: "r1",
      finishedAt: null,
      outcome: null,
    },
  ],
  ...patch,
});

test("only a session's open handoffs count as working for it", () => {
  const items = [
    handoff("a", "research"),
    handoff("b", "research", { status: "completed" }),
    handoff("c", "writer", { fromSessionId: "other" }),
  ];
  expect(openHandoffs(items, "s1").map((h) => h.id)).toEqual(["a"]);
  expect(openHandoffs(items, undefined)).toEqual([]);
});

test("the composer names who needs the owner first, then who is working", () => {
  const one = delegateGroups([handoff("a", "research")]);
  expect(delegateLabel(one)).toBe("Research is on it");
  expect(
    delegateLabel(
      delegateGroups([handoff("a", "research"), handoff("b", "research")]),
    ),
  ).toBe("Research is on it · 2 tasks");
  const mixed = delegateGroups([
    handoff("a", "research"),
    handoff("b", "writer"),
    handoff("c", "finance", { waiting: true }),
    handoff("d", "research"),
  ]);
  expect(mixed.map((g) => g.bot.id)).toEqual(["finance", "research", "writer"]);
  expect(delegateLabel(mixed)).toBe("Finance needs you · 3 more working");
  expect(
    delegateLabel(
      delegateGroups([handoff("a", "research"), handoff("b", "writer")]),
    ),
  ).toBe("2 bots on it · 2 tasks");
});

test("each brief's card belongs under the turn that sent it", () => {
  const followed = handoff("a", "research", {
    requests: [
      {
        ...handoff("x", "y").requests[0]!,
        outcome: "completed",
        finishedAt: 2,
      },
      { ...handoff("x", "y").requests[0]!, fromTurnId: "t2" },
    ],
    waiting: true,
  });
  expect(requestsFromTurn([followed], "t1").map((r) => r.index)).toEqual([0]);
  const [later] = requestsFromTurn([followed], "t2");
  expect(later!.index).toBe(1);
  expect(requestStatus(later!)).toBe("waiting");
  expect(requestStatus(requestsFromTurn([followed], "t1")[0]!)).toBe(
    "completed",
  );
});
