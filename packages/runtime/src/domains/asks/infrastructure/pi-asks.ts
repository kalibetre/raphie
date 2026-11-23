import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  defineDoc,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import type { AskAnswer, Channel } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { isSharedTelegramDestination } from "../../channels/domain/binding.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { ChannelSender } from "../application/ports.ts";
import {
  answerStatus,
  type Ask,
  type AskDelivery,
  askResult,
  validAnswer,
} from "../domain/ask.ts";

export type AskState = { asks: Ask[]; deliveries: AskDelivery[] };

export const Asks = defineDoc<AskState>({
  kind: "raphie.asks",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ asks: [], deliveries: [] }),
});

/** How long a question waits for the owner before the bot moves on. */
const ASK_TTL_MS = 60 * 60_000;

const NO_OWNER =
  "Nobody can answer with buttons in this turn: it came from a schedule, another bot or a group chat. Ask your question in your reply instead.";

/** Posts the question to its chat, or edits that post once it is settled. */
function notify(state: AskState, ask: Ask, kind: AskDelivery["kind"]) {
  const threadId = ask.replyTo?.conversation;
  if (!threadId) return;
  if (kind === "resolved" && !state.deliveries.some((d) => d.askId === ask.id))
    return;
  if (state.deliveries.some((d) => d.id === `${ask.id}:${kind}`)) return;
  state.deliveries.push({
    id: `${ask.id}:${kind}`,
    askId: ask.id,
    threadId,
    connectionId: ask.replyTo?.connectionId,
    kind,
    status: "pending",
    messageId: null,
  });
}

/**
 * A plain copy of a stored question, usable after its transaction ends:
 * the stored one's options and answer are the transaction's live objects.
 */
function detached(ask: Ask): Ask {
  return JSON.parse(JSON.stringify(ask)) as Ask;
}

export class AskService {
  app: DurableContext;

  constructor(app: DurableContext) {
    this.app = app;
  }

  /** Every question asked; empty before the first. */
  async state(): Promise<Readonly<AskState>> {
    return (
      (await this.app.harness.snapshot(Asks, context)) ?? {
        asks: [],
        deliveries: [],
      }
    );
  }

  /**
   * The question for this call, created once: a replayed call finds the one
   * it already asked. `null` when no owner is there to answer with buttons.
   */
  async ensure(
    api: ToolExecutionApi,
    ctx: Context,
    question: Pick<Ask, "question" | "options" | "danger">,
  ) {
    return api.commit(async (tx) => {
      const state = await tx.doc(Asks);
      const existing = state.asks.find((a) => a.taskId === api.taskId);
      if (existing) return detached(existing);
      const chats = await tx.doc(Chats);
      const pending = chats.turns.filter(
        (t) =>
          t.conversationId === api.conversationId && t.status === "pending",
      );
      const turn = pending[0];
      // Nobody is there to press a button for a schedule or another bot. In
      // a chat, the question goes where the message came from, and only to
      // the one person who sent it: never to a group, and never when queued
      // messages make the sender unclear.
      const chat = turn?.source !== "web";
      if (
        !turn ||
        turn.scheduled ||
        turn.handoff ||
        (chat &&
          (!turn.replyTo ||
            isSharedTelegramDestination(turn.replyTo) ||
            pending.length > 1 ||
            !turn.discordUserId))
      )
        return null;
      const now = Date.now();
      const ask: Ask = {
        id: crypto.randomUUID(),
        taskId: api.taskId,
        conversationId: api.conversationId,
        turnId: turn.id,
        ...(chat
          ? { replyTo: turn.replyTo, discordUserId: turn.discordUserId }
          : {}),
        question: question.question,
        options: question.options,
        ...(question.danger ? { danger: true as const } : {}),
        createdAt: now,
        expiresAt: now + (this.app.options.askTtlMs ?? ASK_TTL_MS),
        status: "pending",
        answer: null,
        answeredVia: null,
      };
      state.asks.push(ask);
      notify(state, ask, "question");
      record(await tx.doc(Activity), "ask.requested", "Asked the owner", {
        conversationId: ask.conversationId,
        runId: turn.id,
        operationId: ask.id,
        details: { question: ask.question, expiresAt: ask.expiresAt },
      });
      return detached(ask);
    }, ctx);
  }

  /** Waits until the owner answers or the question expires. */
  async wait(api: ToolExecutionApi, ctx: Context, ask: Ask) {
    const watch = await api.watchDoc(Asks, ctx);
    if (!watch) throw new Error("Missing asks.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          ctx.abortSignal?.removeEventListener("abort", abort);
          resolve();
        };
        abort = () => {
          clearTimeout(timer);
          reject(new Error("Waiting for the owner's answer was interrupted."));
        };
        const inspect = (state: Readonly<AskState> | null) => {
          if (state?.asks.find((a) => a.id === ask.id)?.status !== "pending")
            done();
        };
        ctx.abortSignal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(done, Math.max(0, ask.expiresAt - Date.now()));
        watch.start(async (call) =>
          inspect(call.kind === "value" ? call.value : null),
        );
        inspect(watch.value);
        if (ctx.abortSignal?.aborted) abort();
      });
    } finally {
      clearTimeout(timer);
      ctx.abortSignal?.removeEventListener("abort", abort);
      await watch.stop();
    }
    return api.commit(async (tx) => {
      const state = await tx.doc(Asks);
      const current = state.asks.find((a) => a.id === ask.id)!;
      if (current.status === "pending") {
        current.status = "expired";
        notify(state, current, "resolved");
        record(await tx.doc(Activity), "ask.expired", "No answer in time", {
          conversationId: current.conversationId,
          runId: current.turnId,
          operationId: current.id,
        });
      }
      return detached(current);
    }, ctx);
  }

  /** The owner's answer, from any client. A settled question stays as it was. */
  async answer(
    id: string,
    answer: AskAnswer,
    actor: string,
    via: Channel,
    app?: "desktop",
    from?: ChannelSender,
  ) {
    this.app.authorize(actor);
    return this.app.root.commit(async (tx) => {
      const state = await tx.doc(Asks);
      const ask = state.asks.find((a) => a.id === id);
      if (!ask) throw new InputError("Question not found.", 404);
      if (via !== "web") {
        // A press in a chat counts only from the chat the question was
        // posted to, through the same connection, by the person who asked.
        const posted = state.deliveries.find(
          (d) => d.askId === id && d.kind === "question",
        );
        if (
          !ask.replyTo ||
          !from ||
          posted?.threadId !== from.threadId ||
          (ask.replyTo.connectionId ?? "legacy-discord") !==
            from.connectionId ||
          ask.discordUserId !== from.userId
        )
          throw new InputError(
            "Only the person this question was asked can answer it, where it was asked.",
            403,
          );
      }
      const valid = validAnswer(ask, answer);
      if (!valid)
        throw new InputError("That is not an answer to this question.");
      if (ask.status !== "pending") return ask.status;
      ask.status = answerStatus(ask.status, ask.expiresAt, Date.now());
      if (ask.status !== "answered") return ask.status;
      ask.answer = valid;
      ask.answeredVia = via;
      if (app) ask.answeredApp = app;
      notify(state, ask, "resolved");
      record(await tx.doc(Activity), "ask.answered", "The owner answered", {
        conversationId: ask.conversationId,
        runId: ask.turnId,
        operationId: ask.id,
        details: { via, ...(app ? { app } : {}) },
      });
      return ask.status;
    }, context);
  }
}

/** The `ask_owner` tool: a question with buttons, answered mid-turn. */
export function createAskTools(asks: AskService) {
  return defineExtension({
    name: "raphie.asks",
    tools: [
      defineTool({
        name: "ask_owner",
        description:
          'Ask the owner one question with 2 to 6 answers shown as buttons, and wait for their choice. They can also answer in their own words. Returns the answer. For a confirmation, make the first answer the action itself, worded as a button ("Delete 214 emails"), set danger, and make the second the way out ("Keep them").',
        parameters: obj({
          question: str({
            minLength: 1,
            maxLength: 300,
            description: "The question, in one sentence.",
          }),
          options: arr(
            obj({
              label: str({
                minLength: 1,
                maxLength: 60,
                description: "The answer as the button shows it.",
              }),
              detail: opt(
                str({
                  maxLength: 80,
                  description: "A few words under the label, when needed.",
                }),
              ),
            }),
            { minItems: 2, maxItems: 6 },
          ),
          danger: opt(
            bool({
              description:
                "The first answer deletes, sends or spends something.",
            }),
          ),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const options = args.options.map((o) => ({
            label: o.label,
            ...(o.detail ? { detail: o.detail } : {}),
          }));
          const asked = await asks.ensure(api, ctx, {
            question: args.question,
            options,
            ...(args.danger ? { danger: true as const } : {}),
          });
          if (!asked)
            return {
              output: [{ type: "text", text: NO_OWNER }],
              isError: true,
            };
          const settled =
            asked.status === "pending"
              ? await asks.wait(api, ctx, asked)
              : asked;
          return { output: [{ type: "text", text: askResult(settled) }] };
        },
      }),
    ],
  });
}
