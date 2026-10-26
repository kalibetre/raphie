import { defineDoc, type Tx } from "@earendil-works/pi-durable";
import type { ScheduledJobRun } from "@raphie/contracts";

/** Admission and turn settlement update the same durable record, atomically. */
export const JobRuns = defineDoc<{ items: ScheduledJobRun[] }>({
  kind: "raphie.job-runs",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});

export function isFinished(run: ScheduledJobRun) {
  return run.finishedAt !== null;
}

export async function finishJobRun(
  tx: Tx,
  turnId: string,
  status: "completed" | "failed" | "interrupted",
) {
  const runs = await tx.doc(JobRuns);
  const run = runs.items.find((item) => item.turnId === turnId);
  if (run && !isFinished(run)) {
    run.status = status;
    run.finishedAt = Date.now();
  }
  runs.items = retainJobRuns(runs.items);
}

/** Keep active and unread runs, plus the newest 500 acknowledged terminal runs. */
export function retainJobRuns(items: ScheduledJobRun[]) {
  let terminal = items.filter(
    (item) => isFinished(item) && item.acknowledgedAt !== null,
  ).length;
  return items.filter((item) => {
    if (isFinished(item) && item.acknowledgedAt !== null && terminal > 500) {
      terminal--;
      return false;
    }
    return true;
  });
}

/** Retire only a run that has not been admitted to a conversation. */
export async function interruptUnadmittedJobRun(tx: Tx, runId: string) {
  const runs = await tx.doc(JobRuns);
  const run = runs.items.find((item) => item.id === runId);
  if (run && !run.turnId && !isFinished(run)) {
    run.status = "interrupted";
    run.finishedAt = Date.now();
  }
  runs.items = retainJobRuns(runs.items);
}
