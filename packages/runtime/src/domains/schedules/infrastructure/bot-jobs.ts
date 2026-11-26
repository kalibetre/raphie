import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type Conversation,
  defineDoc,
  defineExtension,
  defineTask,
  type Extension,
  type Harness,
  type TaskId,
  type Tx,
} from "@earendil-works/pi-durable";
import type {
  Page,
  SaveScheduledJob,
  ScheduledJob,
  ScheduledJobRun,
  TurnWork,
  WorkActor,
  WorkItem,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { syncJobItem } from "../../work/infrastructure/work-items.ts";
import { WorkItems } from "../../work/infrastructure/work-store.ts";
import {
  interruptUnadmittedJobRun,
  isFinished,
  JobRuns,
  retainJobRuns,
} from "./job-runs.ts";

const LATE_AFTER_MS = 60_000;

/**
 * A run's prompt. `sessionId` is the item session its first attempt was sent
 * to (null for none), so a retry is admitted as the same request.
 */
type Submission = { eventId: string; text: string; sessionId?: string | null };

/** The work item that follows job `id`. */
const jobItem = (items: WorkItem[] | undefined, id: string) =>
  items?.find((i) => i.origin?.kind === "job" && i.origin.jobId === id);

type StoredJob = ScheduledJob & { taskId: TaskId };

export const Jobs = defineDoc<{ items: StoredJob[] }>({
  kind: "raphie.scheduled-jobs",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});

type Options = {
  root: Conversation;
  harness: Harness;
  install: (extension: Extension) => void;
  /** Marked as scheduled, so the turn shows as a delivery, not an owner message. */
  submit: (
    input: Submission & {
      scheduled: { name: string };
      /** The job's work item, whose session the run goes to. */
      work?: TurnWork;
      sessionId?: string;
    },
  ) => Promise<{ id: string; sessionId: string }>;
  /**
   * Follows a run in its item's session, in the caller's transaction, so
   * its result is posted to the chat when it ends.
   */
  follow?: (
    tx: Tx,
    itemId: string,
    run: { turnId: string; sessionId: string; scheduled: { name: string } },
  ) => Promise<void>;
  busy: () => Promise<boolean>;
};

type Checkpoint =
  | { phase: "wait"; at: number }
  | { phase: "submit"; at: number }
  | { phase: "deliver"; at: number; input: Submission; attempts?: number };

/** Pi owns timers, checkpoints, sleeping-task recovery and replay. */
export class BotJobs {
  private options: Options;
  private gate = new ModelConnectionGate();
  private task: ReturnType<typeof this.createTask>;

  private constructor(options: Options) {
    this.options = options;
    this.task = this.createTask();
    options.install(
      defineExtension({ name: "raphie.jobs", tasks: [this.task] }),
    );
  }

  static open(options: Options) {
    return new BotJobs(options);
  }

  async read(): Promise<ScheduledJob[]> {
    const runs =
      (await this.options.harness.snapshot(JobRuns, context))?.items ?? [];
    return (
      (await this.options.harness.snapshot(Jobs, context))?.items ?? []
    ).map(({ taskId: _, ...job }) => ({
      ...job,
      lastRun: runs.findLast((run) => run.jobId === job.id),
    }));
  }

  async runs(
    options: {
      jobId?: string;
      before?: string;
      limit?: number;
      unread?: boolean;
    } = {},
  ): Promise<Page<ScheduledJobRun> & { total: number }> {
    const runs =
      (await this.options.harness.snapshot(JobRuns, context))?.items ?? [];
    const items = runs
      .filter(
        (run) =>
          (!options.jobId || run.jobId === options.jobId) &&
          (!options.unread || (isFinished(run) && run.acknowledgedAt === null)),
      )
      .reverse();
    const start = options.before
      ? items.findIndex((run) => run.id === options.before) + 1
      : 0;
    if (options.before && start === 0)
      throw new InputError("Run history cursor expired. Reload the history.");
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const page = items.slice(start, start + limit);
    return {
      items: page,
      total: items.length,
      next: start + limit < items.length ? page.at(-1)!.id : null,
    };
  }

  async acknowledge(id: string) {
    await this.options.root.commit(async (tx) => {
      const run = (await tx.doc(JobRuns)).items.find((item) => item.id === id);
      if (!run) throw new InputError("Job run not found.", 404);
      if (isFinished(run)) run.acknowledgedAt ??= Date.now();
    }, context);
  }

  async add(input: SaveScheduledJob) {
    return this.gate.run(async () => {
      await this.options.root.commit(
        (tx) => this.schedule(tx, input, crypto.randomUUID(), "owner"),
        context,
      );
      this.options.harness.resume();
      return this.read();
    });
  }

  /** Tool receipts and schedule changes share one transaction within this bot. */
  async schedule(
    tx: Tx,
    input: SaveScheduledJob,
    id: string = crypto.randomUUID(),
    by: WorkActor = "bot",
  ): Promise<ScheduledJob> {
    const jobs = await tx.doc(Jobs);
    const existing = jobs.items.find((job) => job.id === id);
    if (existing) return existing;
    if (jobs.items.length >= 100)
      throw new InputError("A bot can have at most 100 scheduled jobs.");
    const taskId = await tx.createTask(
      this.task,
      { id, at: input.firstRunAt, manual: false },
      {
        conversationId: this.options.root.id,
        ownership: { kind: "conversation" },
        background: true,
      },
    );
    const job = {
      ...input,
      id,
      taskId,
      enabled: true,
      nextRunAt: input.firstRunAt,
      lastRunAt: null,
      lastStatus: null,
    };
    jobs.items.push(job);
    // Every job is a work item, so "what's going on?" includes it.
    await syncJobItem(tx, id, job, by);
    return job;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<SaveScheduledJob> & { enabled?: boolean },
  ) {
    const job = (await tx.doc(Jobs)).items.find((item) => item.id === id);
    if (!job) throw new InputError("Scheduled job not found.", 404);
    const retiredTaskId = job.taskId;
    Object.assign(job, patch);
    if (patch.firstRunAt !== undefined) {
      job.nextRunAt = patch.firstRunAt;
      job.enabled = patch.enabled ?? true;
    }
    if (job.enabled)
      job.taskId = await tx.createTask(
        this.task,
        { id, at: job.nextRunAt, manual: false },
        {
          conversationId: this.options.root.id,
          ownership: { kind: "conversation" },
          background: true,
        },
      );
    await syncJobItem(tx, id, job, "bot");
    return { job, retiredTaskId };
  }

  async remove(tx: Tx, id: string) {
    const jobs = await tx.doc(Jobs);
    const job = jobs.items.find((item) => item.id === id);
    if (!job) throw new InputError("Scheduled job not found.", 404);
    jobs.items = jobs.items.filter((item) => item.id !== id);
    await syncJobItem(tx, id, undefined, "bot");
    return job.taskId;
  }

  async retire(taskId: TaskId) {
    await this.options.harness.abortTask(taskId, context);
  }

  async change(id: string, action: "enable" | "disable" | "remove" | "run") {
    let abort: TaskId | undefined;
    await this.gate.run(async () => {
      if (action === "run" && (await this.options.busy()))
        throw new InputError(
          "Wait for this bot's active turn or approval before running another job.",
          409,
        );
      await this.options.root.commit(async (tx) => {
        const jobs = await tx.doc(Jobs);
        const job = jobs.items.find((j) => j.id === id);
        if (!job) throw new InputError("Scheduled job not found.", 404);
        if (
          action === "run" &&
          jobItem((await tx.doc(WorkItems)).items, id)?.run
        )
          throw new InputError(
            "This job is still running. Wait for it to finish, or cancel the run under Work.",
            409,
          );
        if (action === "run") {
          await tx.createTask(
            this.task,
            { id, at: Date.now(), manual: true },
            { ownership: { kind: "conversation" }, background: true },
          );
        } else if (action === "enable" && !job.enabled) {
          job.enabled = true;
          job.nextRunAt = Math.max(Date.now(), job.nextRunAt);
          job.taskId = await tx.createTask(
            this.task,
            { id, at: job.nextRunAt, manual: false },
            { ownership: { kind: "conversation" }, background: true },
          );
        } else if (action === "disable" || action === "remove") {
          job.enabled = false;
          abort = job.taskId;
          if (action === "remove")
            jobs.items = jobs.items.filter((j) => j.id !== id);
        }
        await syncJobItem(
          tx,
          id,
          action === "remove" ? undefined : job,
          "owner",
        );
      }, context);
    });
    if (abort) await this.options.harness.abortTask(abort, context);
    this.options.harness.resume();
    return this.read();
  }

  private async markWaiting(job: ScheduledJob, id: string, at: number) {
    const current = (
      await this.options.harness.snapshot(JobRuns, context)
    )?.items.find((run) => run.id === id);
    if (
      current?.waitingForBot ||
      current?.turnId ||
      (current && isFinished(current))
    )
      return;
    await this.options.root.commit(async (tx) => {
      const runs = await tx.doc(JobRuns);
      const run = runs.items.find((item) => item.id === id);
      if (run) {
        if (!run.turnId && !isFinished(run)) run.waitingForBot = true;
      } else
        runs.items.push({
          id,
          jobId: job.id,
          name: job.name,
          scheduledFor: at,
          startedAt: Date.now(),
          finishedAt: null,
          status: "queued",
          sessionId: null,
          turnId: null,
          acknowledgedAt: null,
          waitingForBot: true,
        });
    }, context);
  }

  private createTask() {
    return defineTask<
      { id: string; at: number; manual: boolean },
      Checkpoint,
      null
    >({
      name: "raphie.recurring-prompt",
      version: 1,
      initial: (input) => ({ phase: "wait", at: input.at }),
      phases: {
        wait: (task, runtime, ctx) =>
          runtime.sleepUntil(
            task.state.checkpoint.at,
            { phase: "submit", at: task.state.checkpoint.at },
            ctx,
          ),
        submit: async (task, runtime, ctx) => {
          const job = (await runtime.snapshot(Jobs, ctx))?.items.find(
            (j) => j.id === task.input.id,
          );
          if (
            !job ||
            (!task.input.manual && (!job.enabled || job.taskId !== task.id))
          ) {
            await runtime.commit(async (tx) => {
              await interruptUnadmittedJobRun(
                tx,
                `job:${task.id}:${task.state.checkpoint.at}`,
              );
              return {
                status: "terminal",
                outcome: { status: "completed", result: null },
              };
            }, ctx);
            return;
          }
          if (await this.options.busy()) {
            await this.markWaiting(
              job,
              `job:${task.id}:${task.state.checkpoint.at}`,
              task.state.checkpoint.at,
            );
            await runtime.sleepUntil(
              runtime.now() + 5000,
              task.state.checkpoint,
              ctx,
            );
            return;
          }
          const at = task.state.checkpoint.at;
          await runtime.commit(
            () => ({
              status: "running",
              checkpoint: {
                phase: "deliver",
                at,
                input: {
                  eventId: `job:${task.id}:${at}`,
                  text: job.prompt,
                },
              },
            }),
            ctx,
          );
        },
        deliver: async (task, runtime, ctx) =>
          this.gate.run(async () => {
            const job = (await runtime.snapshot(Jobs, ctx))?.items.find(
              (j) => j.id === task.input.id,
            );
            if (
              !job ||
              (!task.input.manual && (!job.enabled || job.taskId !== task.id))
            ) {
              await runtime.commit(async (tx) => {
                await interruptUnadmittedJobRun(
                  tx,
                  task.state.checkpoint.input.eventId,
                );
                return {
                  status: "terminal",
                  outcome: { status: "completed", result: null },
                };
              }, ctx);
              return;
            }
            // The job's previous run, still going in its item, holds this one back.
            const item = jobItem(
              (await runtime.snapshot(WorkItems, ctx))?.items,
              job.id,
            );
            if ((await this.options.busy()) || item?.run) {
              await this.markWaiting(
                job,
                task.state.checkpoint.input.eventId,
                task.state.checkpoint.at,
              );
              await runtime.sleepUntil(
                runtime.now() + 5000,
                task.state.checkpoint,
                ctx,
              );
              return;
            }
            let status: "submitted" | "failed" = "failed";
            let failureReason: "unknown" | "no_model" = "unknown";
            const runId = task.state.checkpoint.input.eventId;
            await runtime.commit(async (tx) => {
              const runs = await tx.doc(JobRuns);
              if (!runs.items.some((run) => run.id === runId))
                runs.items.push({
                  id: runId,
                  jobId: job.id,
                  name: job.name,
                  scheduledFor: task.state.checkpoint.at,
                  startedAt: Date.now(),
                  finishedAt: null,
                  status: "queued",
                  sessionId: null,
                  turnId: null,
                  acknowledgedAt: null,
                });
              const run = runs.items.find((item) => item.id === runId);
              if (run && !run.turnId) {
                run.waitingForBot = false;
                run.startedAt = Date.now();
                run.late = run.startedAt - run.scheduledFor > LATE_AFTER_MS;
              }
              return { status: "running", checkpoint: task.state.checkpoint };
            }, ctx);
            // The run goes to the job's work item's own session; only its
            // result is posted to the chat. A retry goes where the first
            // attempt went, even if the item has a session by now.
            const pinned = task.state.checkpoint.input.sessionId;
            const sessionId =
              pinned === undefined ? item?.sessionId : (pinned ?? undefined);
            let receipt: { id: string; sessionId: string } | undefined;
            try {
              receipt = await this.options.submit({
                eventId: task.state.checkpoint.input.eventId,
                text: task.state.checkpoint.input.text,
                scheduled: { name: job.name },
                ...(item
                  ? {
                      work: {
                        itemId: item.id,
                        title: item.title,
                        kind: "brief",
                      },
                      ...(sessionId ? { sessionId } : {}),
                    }
                  : {}),
              });
              status = "submitted";
            } catch (error) {
              if (error instanceof InputError && error.code === "no_model")
                failureReason = "no_model";
              // Preserve the admission fingerprint across durable retries.
              const attempts = (task.state.checkpoint.attempts ?? 0) + 1;
              if (attempts < 4) {
                await runtime.sleepUntil(
                  runtime.now() + 1000 * 2 ** (attempts - 1),
                  {
                    ...task.state.checkpoint,
                    input: {
                      ...task.state.checkpoint.input,
                      sessionId: sessionId ?? null,
                    },
                    attempts,
                  },
                  ctx,
                );
                return;
              }
            }
            const once = job.everyMinutes === null;
            const next = runtime.now() + (job.everyMinutes ?? 0) * 60_000;
            await runtime.commit(async (tx) => {
              if (receipt && item && this.options.follow)
                await this.options.follow(tx, item.id, {
                  turnId: receipt.id,
                  sessionId: receipt.sessionId,
                  scheduled: { name: job.name },
                });
              const run = (await tx.doc(JobRuns)).items.find(
                (item) => item.id === runId,
              );
              if (
                run &&
                !run.turnId &&
                status === "failed" &&
                !isFinished(run)
              ) {
                run.status = "failed";
                run.failureReason = failureReason;
                run.finishedAt = Date.now();
              }
              const runHistory = await tx.doc(JobRuns);
              runHistory.items = retainJobRuns(runHistory.items);
              const current = (await tx.doc(Jobs)).items.find(
                (j) => j.id === job.id,
              );
              const replaced =
                !task.input.manual && current?.taskId !== task.id;
              if (current && !replaced) {
                current.lastRunAt = task.state.checkpoint.at;
                current.lastStatus = status;
                if (!task.input.manual) current.nextRunAt = next;
                if (once && !task.input.manual) current.enabled = false;
                await syncJobItem(tx, current.id, current, "bot");
              }
              return task.input.manual || once || replaced
                ? {
                    status: "terminal",
                    outcome: { status: "completed", result: null },
                  }
                : {
                    status: "sleeping",
                    until: next,
                    checkpoint: { phase: "submit", at: next },
                  };
            }, ctx);
          }),
      },
      abort: (task, runtime, ctx) =>
        runtime.commit(async (tx) => {
          await interruptUnadmittedJobRun(
            tx,
            task.state.checkpoint.phase === "deliver"
              ? task.state.checkpoint.input.eventId
              : `job:${task.id}:${task.state.checkpoint.at}`,
          );
          return { status: "terminal", outcome: { status: "aborted" } };
        }, ctx),
    });
  }
}
