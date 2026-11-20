import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import type { AskAnswer, Channel } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import {
  answerStatus,
  type Ask,
  askResult,
  validAnswer,
} from "../domain/ask.ts";

type AskState = { asks: Ask[] };

export const Asks = defineDoc<AskState>({
  kind: "raphie.asks",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ asks: [] }),
});

/** How long a question waits for the owner before the bot moves on. */
const ASK_TTL_MS = 60 * 60_000;

const NO_OWNER =
  "Asking with buttons works only when the owner is in the web workspace or the desktop app, and this turn came from elsewhere. Ask your question in your reply instead.";

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
    return (await this.app.harness.snapshot(Asks, context)) ?? { asks: [] };
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
      const turn = chats.turns.find(
        (t) =>
          t.conversationId === api.conversationId && t.status === "pending",
      );
      // A channel, a schedule or another bot started this turn: nobody is
      // looking at a card to press.
      if (!turn || turn.source !== "web" || turn.scheduled || turn.handoff)
        return null;
      const now = Date.now();
      const ask: Ask = {
        id: crypto.randomUUID(),
        taskId: api.taskId,
        conversationId: api.conversationId,
        turnId: turn.id,
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
      const current = (await tx.doc(Asks)).asks.find((a) => a.id === ask.id)!;
      if (current.status === "pending") {
        current.status = "expired";
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
  ) {
    this.app.authorize(actor);
    return this.app.root.commit(async (tx) => {
      const ask = (await tx.doc(Asks)).asks.find((a) => a.id === id);
      if (!ask) throw new InputError("Question not found.", 404);
      const valid = validAnswer(ask, answer);
      if (!valid)
        throw new InputError("That is not an answer to this question.");
      if (ask.status !== "pending") return ask.status;
      ask.status = answerStatus(ask.status, ask.expiresAt, Date.now());
      if (ask.status !== "answered") return ask.status;
      ask.answer = valid;
      ask.answeredVia = via;
      if (app) ask.answeredApp = app;
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
    sections: [
      section("asks", ({ agent }) => {
        if (!agent.tools.some((tool) => tool.name === "ask_owner")) return;
        return "When you need the owner to decide something before you can go on, call ask_owner with the question and its answers instead of writing the question in your reply; the owner picks with one press. Ask only what you cannot reasonably decide yourself, and one question at a time. Before anything that deletes, sends or spends, ask with the action itself as the first answer and danger set.";
      }),
    ],
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
