import { expect, test } from "bun:test";

import type { ScheduledJobRun, SessionSummary } from "@raphie/contracts";

import { notificationItems } from "../src/presentation/workspace/notification-items";

const bot = { id: "default", name: "Raphie" };
const session = {
  id: "s",
  sessionId: "s",
  title: "Chat",
  lastAt: 10,
  replyCount: 3,
  readReplyCount: 0,
  waiting: false,
} as SessionSummary;
const run = {
  id: "run",
  sessionId: "s",
  turnId: "turn",
  status: "completed",
  finishedAt: 11,
} as ScheduledJobRun;

test("the inbox holds approvals and job runs; new messages stay on the bot in the sidebar", () => {
  const kinds = (s: SessionSummary, jobs = [{ bot, run }]) =>
    notificationItems([bot], new Map([[bot.id, [s]]]), jobs).map(
      (item) => item.kind,
    );
  expect(kinds(session)).toEqual(["job"]);
  expect(kinds(session, [])).toEqual([]);
  expect(kinds({ ...session, waiting: true }).sort()).toEqual([
    "approval",
    "job",
  ]);
});
