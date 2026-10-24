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
import type { SaveScheduledJob, ScheduledJob } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";

type Submission = { eventId: string; text: string; sessionId?: string };

type StoredJob = ScheduledJob & { taskId: TaskId };

const Jobs = defineDoc<{ items: StoredJob[] }>({
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
    input: Submission & { scheduled: { name: string } },
  ) => Promise<{ sessionId: string }>;
  busy: () => Promise<boolean>;
};

type Checkpoint =
  | { phase: "wait"; at: number }
  | { phase: "submit"; at: number }
  | { phase: "deliver"; at: number; input: Submission };

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
    return (
      (await this.options.harness.snapshot(Jobs, context))?.items ?? []
    ).map(({ taskId: _, ...job }) => job);
  }

  async add(input: SaveScheduledJob) {
    return this.gate.run(async () => {
      await this.options.root.commit((tx) => this.schedule(tx, input), context);
      this.options.harness.resume();
      return this.read();
    });
  }

  /** Tool receipts and schedule changes share one transaction within this bot. */
  async schedule(
    tx: Tx,
    input: SaveScheduledJob,
    id: string = crypto.randomUUID(),
    sessionId: string | null = null,
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
      sessionId,
      lastRunAt: null,
      lastStatus: null,
    };
    jobs.items.push(job);
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
    return { job, retiredTaskId };
  }

  async remove(tx: Tx, id: string) {
    const jobs = await tx.doc(Jobs);
    const job = jobs.items.find((item) => item.id === id);
    if (!job) throw new InputError("Scheduled job not found.", 404);
    jobs.items = jobs.items.filter((item) => item.id !== id);
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
      }, context);
    });
    if (abort) await this.options.harness.abortTask(abort, context);
    this.options.harness.resume();
    return this.read();
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
            await runtime.commit(
              () => ({
                status: "terminal",
                outcome: { status: "completed", result: null },
              }),
              ctx,
            );
            return;
          }
          if (await this.options.busy()) {
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
                  ...(job.sessionId ? { sessionId: job.sessionId } : {}),
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
              await runtime.commit(
                () => ({
                  status: "terminal",
                  outcome: { status: "completed", result: null },
                }),
                ctx,
              );
              return;
            }
            if (await this.options.busy()) {
              await runtime.sleepUntil(
                runtime.now() + 5000,
                task.state.checkpoint,
                ctx,
              );
              return;
            }
            let sessionId = job.sessionId;
            // Another queued run may have created the job's conversation since
            // this task checkpointed. Persist the address before using it so a
            // crash retry keeps the same admission fingerprint.
            if (sessionId && !task.state.checkpoint.input.sessionId) {
              const addressedInput = {
                ...task.state.checkpoint.input,
                sessionId,
              };
              await runtime.commit(
                () => ({
                  status: "running",
                  checkpoint: {
                    ...task.state.checkpoint,
                    input: addressedInput,
                  },
                }),
                ctx,
              );
              return;
            }
            let status: "submitted" | "failed" = "failed";
            try {
              sessionId = (
                await this.options.submit({
                  ...task.state.checkpoint.input,
                  scheduled: { name: job.name },
                })
              ).sessionId;
              status = "submitted";
            } catch {
              /* No transport error payload is persisted or exposed. */
            }
            const once = job.everyMinutes === null;
            const next = runtime.now() + (job.everyMinutes ?? 0) * 60_000;
            await runtime.commit(async (tx) => {
              const current = (await tx.doc(Jobs)).items.find(
                (j) => j.id === job.id,
              );
              const replaced =
                !task.input.manual && current?.taskId !== task.id;
              if (current && !replaced) {
                current.lastRunAt = task.state.checkpoint.at;
                current.lastStatus = status;
                current.sessionId = sessionId;
                if (!task.input.manual) current.nextRunAt = next;
                if (once && !task.input.manual) current.enabled = false;
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
      abort: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          ctx,
        ),
    });
  }
}
