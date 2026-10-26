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
