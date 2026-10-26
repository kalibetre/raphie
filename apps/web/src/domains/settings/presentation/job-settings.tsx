import type { ScheduledJob } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Plus } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Calendar } from "../../../shared/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Input } from "../../../shared/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";
import { useBotAutomation } from "../infrastructure/use-bot-automation";
import { JobRunHistory } from "./job-run-history";
import { ScheduledJobCard } from "./scheduled-job-card";
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
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [historyJobId, setHistoryJobId] = useState<string>();
  const openRun = (sessionId: string) =>
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId },
      search: {
        bot: workspace.botId === "default" ? undefined : workspace.botId,
      },
    });
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [repeat, setRepeat] = useState(true);
  const [first, setFirst] = useState(localDateTime);
  const [initialFirst, setInitialFirst] = useState(first);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = data.mutation.isPending;
  const dirty =
    !!(name || prompt) || minutes !== 60 || first !== initialFirst || !repeat;
  const guard = useSettingsGuard(dirty, pending);

  function discard() {
    setName("");
    setPrompt("");
    setMinutes(60);
    setRepeat(true);
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
        input: {
          name,
          prompt,
          everyMinutes: repeat ? minutes : null,
          firstRunAt,
        },
      });
      discard();
      setOpen(false);
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
        title="Scheduled prompts"
        action={
          <Button
            size="sm"
            onClick={() => {
              discard();
              setOpen(true);
            }}
          >
            <Plus size={15} /> Create job
          </Button>
        }
        note="Reminders created in chat reply in that conversation. Jobs created here keep their own conversation. The runtime must be running; tool actions still need approval."
      >
        {data.data.items.length ? (
          data.data.items.map((job) => (
            <ScheduledJobCard
              key={job.id}
              job={job}
              pending={pending}
              onHistory={() => {
                setHistoryJobId(job.id);
                document
                  .getElementById("job-run-history")
                  ?.scrollIntoView({ block: "center" });
              }}
              onChange={(id, action) => void change(id, action)}
              onOpen={(sessionId) =>
                void navigate({
                  to: "/sessions/$sessionId",
                  params: { sessionId },
                  search: {
                    bot:
                      workspace.botId === "default"
                        ? undefined
                        : workspace.botId,
                  },
                })
              }
            />
          ))
        ) : (
          <p className="automation-empty">
            No scheduled jobs yet. Create a reminder or recurring prompt.
          </p>
        )}
      </Group>
      <JobRunHistory
        jobId={historyJobId}
        onClear={() => setHistoryJobId(undefined)}
        onOpen={openRun}
      />
      {message && (
        <p role="status" className="automation-note">
          {message}
        </p>
      )}
      {!open && error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && (dirty || pending)) {
            setError(
              pending
                ? "Wait for the job to finish scheduling."
                : "Discard your draft before closing.",
            );
            return;
          }
          setOpen(next);
        }}
      >
        <DialogContent
          className="job-dialog sm:max-w-[560px]"
          showCloseButton={!pending}
        >
          <DialogHeader>
            <DialogTitle>Create a job</DialogTitle>
            <DialogDescription>
              Times use your local timezone. Recurring jobs repeat at a fixed
              interval.
            </DialogDescription>
          </DialogHeader>
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
            <label htmlFor="job-kind">Schedule</label>
            <Select
              value={repeat ? "repeat" : "once"}
              onValueChange={(value) => setRepeat(value === "repeat")}
            >
              <SelectTrigger id="job-kind">
                <SelectValue>{repeat ? "Recurring" : "Once"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Once</SelectItem>
                <SelectItem value="repeat">Recurring</SelectItem>
              </SelectContent>
            </Select>
            <div className="automation-schedule-fields">
              {repeat && (
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
              )}
              <div>
                <label htmlFor="job-date">First run date</label>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        id="job-date"
                        type="button"
                        variant="outline"
                        className="job-date-trigger"
                      />
                    }
                  >
                    <CalendarDays size={15} />
                    {first
                      ? new Date(
                          `${first.slice(0, 10)}T12:00`,
                        ).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })
                      : "Choose a date"}
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={
                        first
                          ? new Date(`${first.slice(0, 10)}T12:00`)
                          : undefined
                      }
                      onSelect={(date) => {
                        if (!date) return;
                        const local = new Date(
                          date.getTime() - date.getTimezoneOffset() * 60_000,
                        )
                          .toISOString()
                          .slice(0, 10);
                        setFirst(`${local}T${first.slice(11) || "09:00"}`);
                        setCalendarOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label htmlFor="job-time">Time (local)</label>
                <Input
                  id="job-time"
                  type="time"
                  value={first.slice(11)}
                  onChange={(e) =>
                    setFirst(`${first.slice(0, 10)}T${e.target.value}`)
                  }
                  required
                />
              </div>
            </div>
            {(error || guard.message) && (
              <p role="alert" className="settings-error">
                {error || guard.message}
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
                disabled={pending}
                onClick={() => {
                  discard();
                  setOpen(false);
                }}
              >
                {dirty ? "Discard" : "Cancel"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
