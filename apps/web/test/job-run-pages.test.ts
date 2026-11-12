import { expect, test } from "bun:test";

import type { ScheduledJobRun } from "@raphie/contracts";

import { mergeJobRunPages } from "../src/domains/settings/infrastructure/use-job-runs";

const run = (id: string, status: ScheduledJobRun["status"] = "completed") =>
  ({ id, status }) as ScheduledJobRun;

test("live head updates retained runs without duplicates or losing displaced history", () => {
  const pages = [
    [run("b", "running"), run("c")],
    [run("d"), run("e")],
  ];
  const merged = mergeJobRunPages([run("a"), run("b", "completed")], pages);
  expect(merged.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e"]);
  expect(merged[1].status).toBe("completed");
  expect(mergeJobRunPages(undefined, pages).map((item) => item.id)).toEqual([
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("failed reply descriptions keep conversation guidance with a safe unknown reason", async () => {
  const { jobRunDescription } =
    await import("../src/domains/settings/application/job-run-status");
  expect(
    jobRunDescription({
      ...run("reply", "failed"),
      turnId: "turn",
      failureReason: "unknown",
    }),
  ).toContain("Open the conversation");
  expect(
    jobRunDescription({
      ...run("admission", "failed"),
      turnId: null,
      failureReason: "no_model",
    }),
  ).toContain("No model configured");
});
