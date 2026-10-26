import type { ScheduledJob } from "@raphie/contracts";

import { Button } from "../../../shared/ui/button";
import { jobRunStatus } from "../application/job-run-status";

export function ScheduledJobCard({
  job,
  pending,
  onChange,
  onOpen,
  onHistory,
}: {
  job: ScheduledJob;
  pending: boolean;
  onChange: (
    id: string,
    action: "enable" | "disable" | "remove" | "run",
  ) => void;
  onOpen: (sessionId: string) => void;
  onHistory: () => void;
}) {
  const once = job.everyMinutes === null;
  const finished = once && !job.enabled && !!job.lastRunAt;
  return (
    <article className="automation-job">
      <div className="automation-job-heading">
        <h3>{job.name}</h3>
        <span className="session-status">
          {job.enabled
            ? "Active"
            : finished
              ? job.lastRun
                ? jobRunStatus[job.lastRun.status]
                : job.lastStatus === "submitted"
                  ? "Sent"
                  : "Failed"
              : "Paused"}
        </span>
      </div>
      <p className="automation-prompt">{job.prompt}</p>
      <p className="automation-note">
        {once
          ? "One-time reminder"
          : `Every ${job.everyMinutes} ${job.everyMinutes === 1 ? "minute" : "minutes"}`}
        {job.enabled
          ? ` · Next: ${new Date(job.nextRunAt).toLocaleString()}`
          : ""}
      </p>
      <p className="automation-note">
        {job.lastRun
          ? `Last run: ${jobRunStatus[job.lastRun.status]} · ${new Date(job.lastRun.startedAt).toLocaleString()}`
          : job.lastRunAt
            ? `${job.lastStatus === "submitted" ? "Earlier prompt submitted · completion not tracked" : "Last submission failed · check the bot's model connection"}: ${new Date(job.lastRunAt).toLocaleString()}`
            : "No runs yet"}
      </p>
      <div className="automation-actions">
        <Button variant="ghost" size="sm" onClick={onHistory}>
          Run history
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onChange(job.id, "run")}
        >
          Run now
        </Button>
        {!finished && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onChange(job.id, job.enabled ? "disable" : "enable")}
          >
            {job.enabled ? "Pause" : "Resume"}
          </Button>
        )}
        {job.sessionId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(job.sessionId!)}
          >
            Open conversation
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onChange(job.id, "remove")}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}
