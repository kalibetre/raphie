import type { ScheduledJob } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { useBotAutomation } from "../infrastructure/use-bot-automation";
import { Group } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { useSettingsGuard } from "./use-settings-guard";

function localDateTime() {
  const date = new Date(Date.now() + 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function JobSettings() {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  const data = useBotAutomation<ScheduledJob>("jobs");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [first, setFirst] = useState(localDateTime);
  const [initialFirst, setInitialFirst] = useState(first);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = data.mutation.isPending;
  const dirty = !!(name || prompt) || minutes !== 60 || first !== initialFirst;
  const guard = useSettingsGuard(dirty, pending);

  function discard() {
    setName("");
    setPrompt("");
    setMinutes(60);
    const nextFirst = localDateTime();
    setFirst(nextFirst);
    setInitialFirst(nextFirst);
    setError("");
  }

  async function add() {
    setError("");
    setMessage("");
    try {
      const firstRunAt = new Date(first).getTime();
      if (!Number.isFinite(firstRunAt))
        throw new Error("Choose a valid first-run time.");
      await data.mutation.mutateAsync({
        input: { name, prompt, everyMinutes: minutes, firstRunAt },
      });
      discard();
      setMessage("Job scheduled. The runtime must be running when it is due.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not schedule this job.",
      );
    }
  }

  async function change(
    id: string,
    action: "enable" | "disable" | "remove" | "run",
  ) {
    setError("");
    setMessage("");
    try {
      await data.mutation.mutateAsync({ id, input: { action } });
      if (action === "run")
        setMessage(
          "Run queued. Its result will appear in the job's conversation.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change this job.",
      );
    }
  }

  if (!data.data)
    return (
      <SettingsStatus
        title="Scheduled jobs"
        message={data.error ? "Could not load jobs." : "Loading jobs…"}
        onRetry={data.error ? () => void data.refetch() : undefined}
      />
    );
  return (
    <>
      <Group
        title="Recurring prompts"
        note="Each job keeps its own conversation and survives runtime restarts. Missed intervals become one run; tool actions still need approval."
      >
        {data.data.items.length ? (
          data.data.items.map((job) => (
            <article className="automation-job" key={job.id}>
              <div className="automation-job-heading">
                <h3>{job.name}</h3>
                <span className="session-status">
                  {job.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <p className="automation-prompt">{job.prompt}</p>
              <p className="automation-note">
                Every {job.everyMinutes}{" "}
                {job.everyMinutes === 1 ? "minute" : "minutes"}
                {job.enabled
                  ? ` · Next: ${new Date(job.nextRunAt).toLocaleString()}`
                  : ""}
              </p>
              <p className="automation-note">
                {job.lastRunAt
                  ? `${job.lastStatus === "submitted" ? "Last prompt submitted" : "Last submission failed · check the bot's model connection"}: ${new Date(job.lastRunAt).toLocaleString()}`
                  : "No runs yet"}
              </p>
              <div className="automation-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void change(job.id, "run")}
                >
                  Run now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void change(job.id, job.enabled ? "disable" : "enable")
                  }
                >
                  {job.enabled ? "Pause" : "Resume"}
                </Button>
                {job.sessionId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void navigate({
                        to: "/sessions/$sessionId",
                        params: { sessionId: job.sessionId! },
                        search: {
                          bot:
                            workspace.botId === "default"
                              ? undefined
                              : workspace.botId,
                        },
                      })
                    }
                  >
                    Open conversation
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void change(job.id, "remove")}
                >
                  Remove
                </Button>
              </div>
            </article>
          ))
        ) : (
          <p className="automation-empty">
            No scheduled jobs yet. Add a recurring prompt below.
          </p>
        )}
      </Group>
      <Group
        title="Create a job"
        note="Times use your browser's local timezone. Recurrence is a fixed interval, so a 1,440-minute job repeats every 24 hours."
      >
        <form
          className="settings-form automation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label htmlFor="job-name">Job name</label>
          <Input
            id="job-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="Morning project brief"
          />
          <label htmlFor="job-prompt">Prompt</label>
          <Textarea
            id="job-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
            maxLength={4000}
            placeholder="Summarize the project's open tasks and suggest today's priorities."
          />
          <div className="automation-schedule-fields">
            <div>
              <label htmlFor="job-minutes">Repeat every (minutes)</label>
              <Input
                id="job-minutes"
                type="number"
                min={1}
                max={525600}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                required
              />
            </div>
            <div>
              <label htmlFor="job-first">First run (local time)</label>
              <Input
                id="job-first"
                type="datetime-local"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                required
              />
            </div>
          </div>
          {(error || guard.message) && (
            <p role="alert" className="settings-error">
              {error || guard.message}
            </p>
          )}
          {message && (
            <p role="status" className="automation-note">
              {message}
            </p>
          )}
          <div className="automation-actions">
            <Button
              type="submit"
              disabled={pending || !name.trim() || !prompt.trim()}
            >
              {pending ? "Scheduling…" : "Schedule job"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || !dirty}
              onClick={discard}
            >
              Discard
            </Button>
          </div>
        </form>
      </Group>
    </>
  );
}
