import { expect, test } from "bun:test";

import type { ScheduledJobRun, SessionSummary } from "@raphie/contracts";

import { notificationItems } from "../src/presentation/workspace/notification-items";

const bot = { id: "default", name: "Raphie" };
const session = {
  id: "s",
  sessionId: "s",
  title: "Brief",
  lastAt: 10,
  replyTurnId: "turn",
  waiting: false,
} as SessionSummary;
const run = {
  id: "run",
  sessionId: "s",
  turnId: "turn",
  status: "completed",
  finishedAt: 11,
} as ScheduledJobRun;
const jobs = [{ bot, run }];

test("only the exact single unread job reply is combined, without hiding approvals or other replies", () => {
  const project = (s: SessionSummary, count: number, entries = jobs) =>
    notificationItems([bot], new Map([[bot.id, [s]]]), () => count, entries)
      .items;
  expect(project(session, 1).map((item) => item.kind)).toEqual(["job"]);
  expect(
    project({ ...session, waiting: true }, 1)
      .map((item) => item.kind)
      .sort(),
  ).toEqual(["approval", "job"]);
  expect(
    project(session, 2)
      .map((item) => item.kind)
      .sort(),
  ).toEqual(["job", "reply"]);
  expect(
    project({ ...session, replyTurnId: "other" }, 1)
      .map((item) => item.kind)
      .sort(),
  ).toEqual(["job", "reply"]);
  expect(
    project({ ...session, replyTurnId: undefined }, 1)
      .map((item) => item.kind)
      .sort(),
  ).toEqual(["job", "reply"]);
  expect(
    project(session, 1, [{ bot: { ...bot, id: "other" }, run }])
      .map((item) => item.kind)
      .sort(),
  ).toEqual(["job", "reply"]);
});
