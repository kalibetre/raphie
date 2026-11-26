import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  defineExtension,
  defineTask,
  type Tx,
} from "@earendil-works/pi-durable";
import type { TurnFailure, TurnWork, WorkItem } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { HANDOFF_RESULT_MAX_LENGTH } from "../../conversations/domain/admission.ts";
import { clip, isOpen, LIMITS } from "../domain/work-item.ts";
import { WorkItems } from "./work-store.ts";

/** A run's turn, as the item's session has it. */
export type RunTurn = {
  status: "pending" | "done" | "error";
  answer: string | null;
  cancelled?: boolean;
  failure?: TurnFailure;
};

type Options = {
  /** The bot's root conversation, which owns the runs' tasks. */
  root: () => {
    id: ConversationId;
    commit: <T>(change: (tx: Tx) => Promise<T>, ctx: Context) => Promise<T>;
  };
  /** Sends a brief to an item's session, or a result to the chat. */
  submit: (input: {
    eventId: string;
    text: string;
    sessionId?: string;
    work: TurnWork;
  }) => Promise<{ id: string; sessionId: string }>;
  /** Posts a job's result into the chat as the bot's message, with no model turn. */
  post: (input: {
    runKey: string;
    work: TurnWork;
    scheduled?: { name: string };
    text: string;
    fromTurnId?: string;
  }) => Promise<string>;
  /** A turn by id; undefined once it no longer exists. */
  turn: (turnId: string) => Promise<RunTurn | undefined>;
  /** Stops the running turn of a session. */
  stop: (sessionId: string) => Promise<void>;
  /** How often a run checks on its turn. */
  pollMs?: number;
};

type Outcome = NonNullable<TurnWork["outcome"]>;

type Checkpoint =
  | { phase: "deliver"; attempts?: number }
  | { phase: "wait"; turnId: string }
  | { phase: "report"; outcome: Outcome; text: string; attempts?: number };

const MAX_ATTEMPTS = 4;

const retryable = (error: unknown) =>
  !(error instanceof InputError) || error.status >= 500;

/**
 * What a run says it came to, for the chat to read as data, cut to what a
 * result can hold with a note saying so.
 */
export function outcomeText(
  outcome: Outcome,
  answer: string | null,
  why?: string,
) {
  const text =
    outcome === "completed"
      ? (answer ?? "")
      : outcome === "cancelled"
        ? "The run was cancelled."
        : `The run failed${why ? `: ${why}` : "."}`;
  if (text.length <= HANDOFF_RESULT_MAX_LENGTH) return text;
  const note =
    "\n\n[The reply was cut here: it was longer than a result can hold. The full reply is in the item's session.]";
  return text.slice(0, HANDOFF_RESULT_MAX_LENGTH - note.length) + note;
}

/**
 * Background runs of work items. Each run is a durable task in the bot: it
 * sends the brief to the item's own session (made on its first run and kept
 * while the item exists), waits for that turn to settle, and brings the
 * result back to the chat. One run at a time per item.
 */
export class WorkRuns {
  private options: Options;
  private task: ReturnType<WorkRuns["createTask"]>;

  constructor(options: Options) {
    this.options = options;
    this.task = this.createTask();
  }

  /** The runs' task, installed with the bot so unfinished runs recover. */
  extension() {
    return defineExtension({ name: "raphie.work-runs", tasks: [this.task] });
  }

  /** Starts a run of item `id` with `brief`, in the caller's transaction, or says why not. */
  async start(tx: Tx, id: string, brief: string): Promise<WorkItem | string> {
    const item = (await tx.doc(WorkItems)).items.find((i) => i.id === id);
    if (!item) return `No work item ${id}.`;
    if (!isOpen(item.status))
      return `${item.id} is ${item.status}. Open a new item if the work starts again.`;
    if (item.run)
      return `${item.id} is already running. Wait for its result, or ask the owner to cancel it.`;
    const now = Date.now();
    const runId = crypto.randomUUID();
    item.run = { id: runId, startedAt: now };
    item.status = "active";
    delete item.waitingOn;
    item.updatedAt = now;
    await tx.createTask(
      this.task,
      { itemId: item.id, runId, brief },
      {
        conversationId: this.options.root().id,
        ownership: { kind: "conversation" },
        background: true,
      },
    );
    return JSON.parse(JSON.stringify(item)) as WorkItem;
  }

  /**
   * Follows a job's run already delivered to its item's session, in the
   * caller's transaction: when the turn ends, its result is posted to the
   * chat as the bot's message. It marks the item as running, so the owner
   * can cancel it, unless another run already holds the marker.
   */
  async follow(
    tx: Tx,
    itemId: string,
    run: { turnId: string; sessionId: string; scheduled: { name: string } },
  ) {
    const item = (await tx.doc(WorkItems)).items.find((i) => i.id === itemId);
    if (!item) return;
    const runId = `job:${run.turnId}`;
    item.sessionId = run.sessionId;
    item.run ??= { id: runId, startedAt: Date.now(), turnId: run.turnId };
    await tx.createTask(
      this.task,
      {
        itemId,
        runId,
        brief: "",
        turnId: run.turnId,
        scheduled: run.scheduled,
      },
      {
        conversationId: this.options.root().id,
        ownership: { kind: "conversation" },
        background: true,
      },
    );
  }

  /**
   * Stops an item's running turn; the run then reports it as cancelled. A
   * run whose turn already ended without reporting is let go of.
   */
  async cancel(item: WorkItem | undefined) {
    if (!item) throw new InputError("Work item not found.", 404);
    if (!item.run) throw new InputError(`${item.id} has nothing running.`, 409);
    if (!item.run.turnId || !item.sessionId)
      throw new InputError(
        `${item.id} is still starting. Try again in a moment.`,
        409,
      );
    const turn = await this.options.turn(item.run.turnId);
    if (turn?.status === "pending") {
      await this.options.stop(item.sessionId);
      return;
    }
    await this.options.root().commit(async (tx) => {
      const stored = (await tx.doc(WorkItems)).items.find(
        (i) => i.id === item.id,
      );
      if (stored?.run?.turnId === item.run?.turnId) delete stored?.run;
    }, context);
  }

  private createTask() {
    const pollMs = this.options.pollMs ?? 1000;
    const finish = {
      status: "terminal",
      outcome: { status: "completed", result: null },
    } as const;
    return defineTask<
      {
        itemId: string;
        runId: string;
        brief: string;
        /** A job's run, already delivered: follow its turn and post the result. */
        turnId?: string;
        scheduled?: { name: string };
      },
      Checkpoint,
      null
    >({
      name: "raphie.work-run",
      version: 1,
      initial: (input) =>
        input.turnId
          ? { phase: "wait", turnId: input.turnId }
          : { phase: "deliver" },
      // An aborted run frees its item for the next one.
      abort: (task, runtime, ctx) =>
        runtime.commit(async (tx) => {
          const stored = (await tx.doc(WorkItems)).items.find(
            (i) => i.id === task.input.itemId,
          );
          // Only this run's marker: a later run may already have started.
          if (stored?.run?.id === task.input.runId) delete stored.run;
          return { status: "terminal", outcome: { status: "aborted" } };
        }, ctx),
      phases: {
        deliver: async (task, runtime, ctx) => {
          const { itemId, runId, brief } = task.input;
          const item = (await runtime.snapshot(WorkItems, ctx))?.items.find(
            (i) => i.id === itemId,
          );
          // Closed, or let go of, before its brief went out: nothing is sent.
          if (item?.run?.id !== runId || !isOpen(item.status)) {
            await runtime.commit(async (tx) => {
              const stored = (await tx.doc(WorkItems)).items.find(
                (i) => i.id === itemId,
              );
              if (stored?.run?.id === runId) delete stored.run;
              return finish;
            }, ctx);
            return;
          }
          try {
            // A retry reuses the event ID, so the session admits one turn.
            const receipt = await this.options.submit({
              eventId: `work:${runId}`,
              text: brief,
              ...(item.sessionId ? { sessionId: item.sessionId } : {}),
              work: { itemId, title: item.title, kind: "brief" },
            });
            let closed = false;
            await runtime.commit(async (tx) => {
              const stored = (await tx.doc(WorkItems)).items.find(
                (i) => i.id === itemId,
              );
              if (stored) {
                stored.sessionId = receipt.sessionId;
                if (stored.run?.id === runId) stored.run.turnId = receipt.id;
                closed = !isOpen(stored.status);
              }
              return {
                status: "running",
                checkpoint: { phase: "wait", turnId: receipt.id },
              };
            }, ctx);
            // Closed while the brief was going out: stop what it started.
            if (closed) await this.options.stop(receipt.sessionId);
          } catch (error) {
            const attempts = (task.state.checkpoint.attempts ?? 0) + 1;
            if (retryable(error) && attempts < MAX_ATTEMPTS) {
              await runtime.sleepUntil(
                runtime.now() + 1000 * 2 ** (attempts - 1),
                { phase: "deliver", attempts },
                ctx,
              );
              return;
            }
            const why = error instanceof Error ? error.message : String(error);
            await runtime.commit(
              () => ({
                status: "running",
                checkpoint: {
                  phase: "report",
                  outcome: "failed",
                  text: outcomeText(
                    "failed",
                    null,
                    `it could not start (${why})`,
                  ),
                },
              }),
              ctx,
            );
          }
        },
        wait: async (task, runtime, ctx) => {
          const turn = await this.options.turn(task.state.checkpoint.turnId);
          if (turn?.status === "pending") {
            await runtime.sleepUntil(
              runtime.now() + pollMs,
              task.state.checkpoint,
              ctx,
            );
            return;
          }
          const outcome: Outcome = !turn
            ? "failed"
            : turn.cancelled
              ? "cancelled"
              : turn.status === "done" && turn.answer
                ? "completed"
                : "failed";
          await runtime.commit(
            () => ({
              status: "running",
              checkpoint: {
                phase: "report",
                outcome,
                text: outcomeText(
                  outcome,
                  turn?.answer ?? null,
                  turn ? turn.failure?.message : "its session is gone",
                ),
              },
            }),
            ctx,
          );
        },
        report: async (task, runtime, ctx) => {
          const checkpoint = task.state.checkpoint;
          const { itemId, runId } = task.input;
          const item = (await runtime.snapshot(WorkItems, ctx))?.items.find(
            (i) => i.id === itemId,
          );
          let resultTurn: string | undefined;
          // A closed item keeps its result but tells the chat nothing, except
          // a job's own run: a one-time job's item closes as it runs.
          if (item && (isOpen(item.status) || task.input.scheduled))
            try {
              const work = {
                itemId,
                title: item.title,
                kind: "result" as const,
                outcome: checkpoint.outcome,
              };
              // A job's result is the bot's message already: posted as it is.
              resultTurn = task.input.scheduled
                ? await this.options.post({
                    runKey: runId,
                    work,
                    scheduled: task.input.scheduled,
                    text: checkpoint.text,
                    ...(task.input.turnId
                      ? { fromTurnId: task.input.turnId }
                      : {}),
                  })
                : (
                    await this.options.submit({
                      eventId: `work:${runId}:result`,
                      text: checkpoint.text,
                      work,
                    })
                  ).id;
            } catch (error) {
              const attempts = (checkpoint.attempts ?? 0) + 1;
              if (retryable(error) && attempts < MAX_ATTEMPTS) {
                await runtime.sleepUntil(
                  runtime.now() + 1000 * 2 ** (attempts - 1),
                  { ...checkpoint, attempts },
                  ctx,
                );
                return;
              }
              // The item below still records how the run ended.
            }
          await runtime.commit(async (tx) => {
            const stored = (await tx.doc(WorkItems)).items.find(
              (i) => i.id === itemId,
            );
            if (stored) {
              const now = Date.now();
              if (stored.run?.id === runId) delete stored.run;
              if (checkpoint.text)
                stored.result = {
                  text: clip(checkpoint.text, LIMITS.result),
                  at: now,
                  ...(resultTurn ? { turnId: resultTurn } : {}),
                };
              stored.updatedAt = now;
            }
            return finish;
          }, ctx);
        },
      },
    });
  }
}
