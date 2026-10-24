import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type Conversation,
  defineDoc,
  defineExtension,
  defineTask,
  type Extension,
  type Harness,
  type TaskId,
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
  submit: (input: Submission) => Promise<{ sessionId: string }>;
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
      await this.options.root.commit(async (tx) => {
        const jobs = await tx.doc(Jobs);
        if (jobs.items.length >= 100)
          throw new InputError("A bot can have at most 100 scheduled jobs.");
        const id = crypto.randomUUID();
        const taskId = await tx.createTask(
          this.task,
          { id, at: input.firstRunAt, manual: false },
          { ownership: { kind: "conversation" }, background: true },
        );
        jobs.items.push({
          ...input,
          id,
          taskId,
          enabled: true,
          nextRunAt: input.firstRunAt,
          sessionId: null,
          lastRunAt: null,
          lastStatus: null,
        });
      }, context);
      this.options.harness.resume();
      return this.read();
    });
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
          if (!job || (!job.enabled && !task.input.manual)) {
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
            if (!job || (!job.enabled && !task.input.manual)) {
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
                await this.options.submit(task.state.checkpoint.input)
              ).sessionId;
              status = "submitted";
            } catch {
              /* No transport error payload is persisted or exposed. */
            }
            const next = runtime.now() + job.everyMinutes * 60_000;
            await runtime.commit(async (tx) => {
              const current = (await tx.doc(Jobs)).items.find(
                (j) => j.id === job.id,
              );
              if (current) {
                current.lastRunAt = task.state.checkpoint.at;
                current.lastStatus = status;
                current.sessionId = sessionId;
                if (!task.input.manual) current.nextRunAt = next;
              }
              return task.input.manual
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
