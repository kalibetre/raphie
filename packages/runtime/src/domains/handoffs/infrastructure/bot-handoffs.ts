import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type Conversation,
  defineDoc,
  defineExtension,
  defineTask,
  type Extension,
  type Harness,
  type Tx,
} from "@earendil-works/pi-durable";
import type {
  Handoff,
  HandoffOutcome,
  TurnFailure,
  TurnHandoff,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  continuedSession,
  handoffStatus,
  MAX_OPEN_HANDOFFS_PER_BOT,
  openHandoffs,
  resultText,
} from "../domain/handoff.ts";

export type Peer = { id: string; name: string };

/** The other bots, as the host that holds every bot exposes them to one. */
export type HandoffPeers = {
  self(): Peer;
  /** Every other live bot. */
  others(): Peer[];
  /** Another live bot by ID or name; never this bot. */
  find(idOrName: string): Peer | undefined;
  submit(
    botId: string,
    input: {
      eventId: string;
      text: string;
      sessionId?: string;
      handoff: TurnHandoff;
    },
  ): Promise<{ id: string; sessionId: string }>;
  /** Whether the task's session in the other bot waits for an owner approval. */
  waiting(botId: string, sessionId: string): Promise<boolean>;
  /** Stops the task's session in the other bot. */
  stop(botId: string, sessionId: string): Promise<void>;
  /** Undefined when the bot or the turn no longer exists. Throws while it is unavailable. */
  turn(
    botId: string,
    turnId: string,
  ): Promise<
    | {
        status: "pending" | "done" | "error";
        answer: string | null;
        cancelled?: boolean;
        failure?: TurnFailure;
      }
    | undefined
  >;
};

type Options = {
  root: Conversation;
  harness: Harness;
  install: (extension: Extension) => void;
  uninstall: (extension: Extension) => void;
  /** Tools for this bot, offered only while another bot exists. */
  tools: (handoffs: BotHandoffs) => Extension;
  peers: HandoffPeers;
  /** Delivers a result into this bot's session as a marked turn. */
  report: (input: {
    eventId: string;
    text: string;
    sessionId: string;
    handoff: TurnHandoff;
  }) => Promise<unknown>;
  /** How often a waiting handoff checks the other bot's turn. */
  pollMs?: number;
};

const Handoffs = defineDoc<{ items: Handoff[] }>({
  kind: "raphie.handoffs",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});

type Checkpoint =
  | { phase: "deliver"; attempts?: number }
  | { phase: "wait"; turnId: string }
  | {
      phase: "report";
      outcome: HandoffOutcome;
      text: string;
      attempts?: number;
    };

const MAX_ATTEMPTS = 4;

const retryable = (error: unknown) =>
  !(error instanceof InputError) || error.status >= 500;

/**
 * Tasks this bot hands to other bots. Each request is a durable task in this
 * bot: it delivers the brief, waits for the other bot's turn to settle, and
 * returns the result to the session the task came from.
 */
export class BotHandoffs {
  private options: Options;
  private task: ReturnType<typeof this.createTask>;
  private tools: Extension;
  private offered = false;

  private constructor(options: Options) {
    this.options = options;
    this.task = this.createTask();
    // Tasks stay registered so unfinished work recovers after a restart.
    options.install(
      defineExtension({ name: "raphie.handoffs", tasks: [this.task] }),
    );
    this.tools = options.tools(this);
  }

  static open(options: Options) {
    const handoffs = new BotHandoffs(options);
    handoffs.refresh();
    return handoffs;
  }

  /** The bots this bot may hand tasks to: every other bot, as they are now. */
  targets(): Peer[] {
    return this.options.peers.others();
  }

  self() {
    return this.options.peers.self();
  }

  /** Offers the tools while another bot exists. The host calls this as bots come and go. */
  refresh() {
    const offer = this.targets().length > 0;
    if (offer === this.offered) return;
    if (offer) this.options.install(this.tools);
    else this.options.uninstall(this.tools);
    this.offered = offer;
  }

  async read(): Promise<Handoff[]> {
    return structuredClone(
      (await this.options.harness.snapshot(Handoffs, context))?.items ?? [],
    );
  }

  /** Handoffs with whether each open one waits for the owner, newest first. */
  async list(): Promise<Handoff[]> {
    const items = (await this.read()).reverse();
    await Promise.all(
      items.map(async (item) => {
        if (item.status !== "working" || !item.toSessionId) return;
        try {
          item.waiting = await this.options.peers.waiting(
            item.to.id,
            item.toSessionId,
          );
        } catch {
          // An unavailable bot is not known to be waiting.
        }
      }),
    );
    return items;
  }

  /**
   * Stops the other bot's work on a handoff. The waiting request then sees the
   * stopped turn and reports the cancellation back like any other result.
   */
  async cancel(id: string) {
    const handoff = (await this.read()).find((item) => item.id === id);
    if (!handoff) throw new InputError("Handoff not found.", 404);
    if (handoff.status !== "working")
      throw new InputError("This task has already finished.", 409);
    if (!handoff.toSessionId)
      throw new InputError(
        `${handoff.to.name} has not received the task yet. Try again in a moment.`,
        409,
      );
    await this.options.peers.stop(handoff.to.id, handoff.toSessionId);
  }

  /** Records a new handoff and starts delivering it, in the caller's transaction. */
  async create(
    tx: Tx,
    input: { id: string; to: string; title: string; brief: string },
    from: { sessionId: string; turnId: string | null },
  ) {
    const doc = await tx.doc(Handoffs);
    const existing = doc.items.find((item) => item.id === input.id);
    if (existing) return existing;
    const to = this.options.peers.find(input.to);
    if (!to)
      throw new InputError(
        `There is no other bot named ${input.to}. You can hand tasks to: ${this.targets()
          .map((peer) => peer.name)
          .join(", ")}.`,
      );
    if (openHandoffs(doc.items, to.id) >= MAX_OPEN_HANDOFFS_PER_BOT)
      throw new InputError(
        `${to.name} already has ${MAX_OPEN_HANDOFFS_PER_BOT} open tasks from you. Wait for one to finish.`,
      );
    const handoff: Handoff = {
      id: input.id,
      to,
      title: input.title,
      fromSessionId: from.sessionId,
      toSessionId: null,
      status: "working",
      createdAt: Date.now(),
      requests: [
        {
          brief: input.brief,
          fromTurnId: from.turnId,
          sentAt: Date.now(),
          turnId: null,
          finishedAt: null,
          outcome: null,
        },
      ],
    };
    doc.items.push(handoff);
    await this.start(tx, handoff.id, 0);
    return handoff;
  }

  /** Sends a further brief into a handoff's session, in the caller's transaction. */
  async followUp(
    tx: Tx,
    id: string,
    brief: string,
    from: { sessionId: string; turnId: string | null },
  ) {
    const doc = await tx.doc(Handoffs);
    const handoff = doc.items.find((item) => item.id === id);
    if (!handoff || handoff.fromSessionId !== from.sessionId)
      throw new InputError("No task with that ID was handed off from here.");
    if (!handoff.toSessionId)
      throw new InputError(
        `${handoff.to.name} has not received the task yet. Wait for it to arrive.`,
      );
    if (!this.options.peers.find(handoff.to.id))
      throw new InputError(`${handoff.to.name} no longer exists.`);
    handoff.requests.push({
      brief,
      fromTurnId: from.turnId,
      sentAt: Date.now(),
      turnId: null,
      finishedAt: null,
      outcome: null,
    });
    handoff.status = "working";
    await this.start(tx, handoff.id, handoff.requests.length - 1);
    return handoff;
  }

  private async start(tx: Tx, handoffId: string, request: number) {
    await tx.createTask(
      this.task,
      { handoffId, request },
      {
        conversationId: this.options.root.id,
        ownership: { kind: "conversation" },
        background: true,
      },
    );
  }

  private createTask() {
    const pollMs = this.options.pollMs ?? 2000;
    const find = async (tx: Tx, id: string) =>
      (await tx.doc(Handoffs)).items.find((item) => item.id === id);
    return defineTask<{ handoffId: string; request: number }, Checkpoint, null>(
      {
        name: "raphie.handoff",
        version: 1,
        initial: () => ({ phase: "deliver" }),
        phases: {
          deliver: async (task, runtime, ctx) => {
            const { handoffId, request: n } = task.input;
            const handoff = (await runtime.snapshot(Handoffs, ctx))?.items.find(
              (item) => item.id === handoffId,
            );
            const request = handoff?.requests[n];
            if (!handoff || !request) {
              await runtime.commit(
                () => ({
                  status: "terminal",
                  outcome: { status: "completed", result: null },
                }),
                ctx,
              );
              return;
            }
            // One conversation talks to another bot in one session: a new
            // task joins the session earlier tasks from here went to. Save
            // the address first, so a retried delivery keeps the same one.
            const joined = !handoff.toSessionId
              ? continuedSession(
                  (await runtime.snapshot(Handoffs, ctx))?.items ?? [],
                  handoff,
                )
              : undefined;
            if (joined)
              await runtime.commit(async (tx) => {
                const stored = await find(tx, handoffId);
                if (stored && !stored.toSessionId) stored.toSessionId = joined;
                return { status: "running", checkpoint: task.state.checkpoint };
              }, ctx);
            const sessionId = handoff.toSessionId ?? joined;
            try {
              // A retry reuses the event ID, so the other bot admits one turn.
              const receipt = await this.options.peers.submit(handoff.to.id, {
                eventId: `handoff:${handoffId}:${n}`,
                text: request.brief,
                ...(sessionId ? { sessionId } : {}),
                handoff: {
                  id: handoffId,
                  kind: "task",
                  bot: this.options.peers.self(),
                  title: handoff.title,
                },
              });
              await runtime.commit(async (tx) => {
                const stored = await find(tx, handoffId);
                if (stored) {
                  stored.toSessionId = receipt.sessionId;
                  stored.requests[n]!.turnId = receipt.id;
                }
                return {
                  status: "running",
                  checkpoint: { phase: "wait", turnId: receipt.id },
                };
              }, ctx);
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
              await runtime.commit(
                () => ({
                  status: "running",
                  checkpoint: {
                    phase: "report",
                    outcome: "failed",
                    text: resultText(
                      handoff.to.name,
                      "failed",
                      null,
                      `The task could not be delivered: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                  },
                }),
                ctx,
              );
            }
          },
          wait: async (task, runtime, ctx) => {
            const handoff = (await runtime.snapshot(Handoffs, ctx))?.items.find(
              (item) => item.id === task.input.handoffId,
            );
            if (!handoff) {
              await runtime.commit(
                () => ({
                  status: "terminal",
                  outcome: { status: "completed", result: null },
                }),
                ctx,
              );
              return;
            }
            let turn: Awaited<ReturnType<HandoffPeers["turn"]>>;
            try {
              turn = await this.options.peers.turn(
                handoff.to.id,
                task.state.checkpoint.turnId,
              );
            } catch {
              // The other bot is restarting or unavailable; its turn survives.
              turn = { status: "pending", answer: null };
            }
            if (turn?.status === "pending") {
              await runtime.sleepUntil(
                runtime.now() + pollMs,
                task.state.checkpoint,
                ctx,
              );
              return;
            }
            const outcome: HandoffOutcome = !turn
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
                  text: resultText(
                    handoff.to.name,
                    outcome,
                    outcome === "completed" ? (turn?.answer ?? null) : null,
                    turn
                      ? turn.failure?.message
                      : `${handoff.to.name} is no longer available.`,
                  ),
                },
              }),
              ctx,
            );
          },
          report: async (task, runtime, ctx) => {
            const checkpoint = task.state.checkpoint;
            const { handoffId, request: n } = task.input;
            const handoff = (await runtime.snapshot(Handoffs, ctx))?.items.find(
              (item) => item.id === handoffId,
            );
            if (handoff)
              try {
                await this.options.report({
                  eventId: `handoff:${handoffId}:${n}:result`,
                  text: checkpoint.text,
                  sessionId: handoff.fromSessionId,
                  handoff: {
                    id: handoffId,
                    kind: "result",
                    bot: handoff.to,
                    title: handoff.title,
                    outcome: checkpoint.outcome,
                  },
                });
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
                // The record below still shows how the task ended.
              }
            await runtime.commit(async (tx) => {
              const stored = await find(tx, handoffId);
              const request = stored?.requests[n];
              if (stored && request && request.outcome === null) {
                request.outcome = checkpoint.outcome;
                request.finishedAt = Date.now();
                stored.status = handoffStatus(stored);
              }
              return {
                status: "terminal",
                outcome: { status: "completed", result: null },
              };
            }, ctx);
          },
        },
        abort: (task, runtime, ctx) =>
          runtime.commit(async (tx) => {
            const stored = await find(tx, task.input.handoffId);
            const request = stored?.requests[task.input.request];
            if (stored && request && request.outcome === null) {
              request.outcome = "cancelled";
              request.finishedAt = Date.now();
              stored.status = handoffStatus(stored);
            }
            return { status: "terminal", outcome: { status: "aborted" } };
          }, ctx),
      },
    );
  }
}
