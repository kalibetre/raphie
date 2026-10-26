import type { ScheduledJobRun } from "@raphie/contracts";

export const jobRunStatus: Record<ScheduledJobRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function jobRunDescription(run: ScheduledJobRun) {
  if (run.status === "failed")
    return run.turnId
      ? "The reply failed. Open the conversation to inspect it."
      : "The prompt could not start. Check the bot's model connection.";
  if (run.status === "interrupted")
    return "Execution was interrupted. Inspect the conversation before retrying any actions.";
  if (run.status === "running")
    return "Reply in progress; tool actions may be waiting for your approval.";
  if (run.status === "queued") return "Waiting for prompt admission.";
  return "The reply is ready in its conversation.";
}
