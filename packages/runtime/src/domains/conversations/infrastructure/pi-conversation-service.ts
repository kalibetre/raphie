import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationId, ModelRef } from "@earendil-works/pi-durable";
import { configure, defineDoc, defineTask } from "@earendil-works/pi-durable";
import type { Channel as Source } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { sameDestination } from "../../channels/domain/binding.ts";
import { ChannelBindings } from "../../channels/infrastructure/pi-bindings.ts";
import type { ConversationCommands } from "../application/ports.ts";
import { messageViolation } from "../domain/admission.ts";
import type {
  ChatConversation,
  ChatTurn,
  ChatDelivery,
} from "../domain/model.ts";
import { newSessionId } from "./session-id.ts";

type ChatState = {
  conversations: ChatConversation[];
  turns: ChatTurn[];
  deliveries: ChatDelivery[];
};

export const Chats = defineDoc<ChatState>({
  kind: "raphie.chats",
  version: 1,
  scope: "session",
  initial: () => ({ conversations: [], turns: [], deliveries: [] }),
});

export const chatWorkflow = defineTask<
  { turnId: string; conversationId: ConversationId; text: string },
  { phase: "reply" },
  null
>({
  name: "raphie.chat-reply",
  version: 1,
  initial: () => ({ phase: "reply" }),
  phases: {
    reply: async (task, runtime, ctx) => {
      const conversation = await runtime.conversation(
        task.input.conversationId,
        ctx,
      );
      if (!conversation) throw new Error("Chat conversation not found.");
      // Durable admission key closes the crash window between submit and waiting.
      const submission = await conversation.submit(
        {
          type: "input",
          content: task.input.text,
          requestId: task.input.turnId,
          whenBusy: "followUp",
        },
        ctx,
      );
      const settled = await submission.wait(ctx);
      await runtime.commit(async (tx) => {
        const entry =
          settled.type === "input" && settled.status === "done"
            ? await tx.entry(settled.answer)
            : undefined;
        const answer =
          entry?.model
            ?.flatMap((message) =>
              message.role === "assistant"
                ? message.content.flatMap((part) =>
                    part.type === "text" ? [part.text] : [],
                  )
                : [],
            )
            .join("\n") || null;
        const state = await tx.doc(Chats);
        const turn = state.turns.find((t) => t.id === task.input.turnId)!;
        turn.status = answer ? "done" : "error";
        turn.answer = answer;
        record(
          await tx.doc(Activity),
          answer ? "run.completed" : "run.failed",
          answer ? "Reply completed" : "Reply failed",
          { conversationId: turn.conversationId, runId: turn.id },
        );
        const destination = turn.replyTo?.conversation;
        if (destination) {
          const text =
            answer ??
            "I could not complete that reply. Check the model configuration and send a new message to retry.";
          state.deliveries.push({
            id: `${turn.id}:reply`,
            turnId: turn.id,
            threadId: destination,
            connectionId: turn.replyTo?.connectionId,
            text,
            status: "pending",
          });
        }
        return {
          status: "terminal",
          outcome: { status: "completed", result: null },
        };
      }, ctx);
    },
  },
  abort: async (_task, runtime, ctx) => {
    await runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      ctx,
    );
  },
});

export class ChatService implements ConversationCommands {
  app: DurableContext;
  model: ModelRef | undefined;

  constructor(app: DurableContext, model?: ModelRef) {
    this.app = app;
    this.model = model;
  }

  async state() {
    return (await this.app.harness.snapshot(Chats, context))!;
  }

  async send(input: {
    source: Source;
    eventId: string;
    actor: string;
    text: string;
    conversationId?: number;
    sessionId?: string;
    discordThreadId?: string;
    connectionId?: string;
  }) {
    this.app.authorize(input.actor);
    if (!this.model)
      throw new InputError(
        "Chat needs OPENROUTER_API_KEY and RAPHIE_MODEL configured on the server.",
        503,
      );
    const violation = messageViolation(input);
    if (violation) throw new InputError(violation);
    const model = this.model;
    const requestKey = `${input.source}:${input.eventId}`;
    const result = await this.app.root.commit(async (tx) => {
      const state = await tx.doc(Chats);
      const bindings = (await tx.doc(ChannelBindings)).bindings;
      const replyTo =
        input.source === "discord" && input.discordThreadId
          ? {
              provider: "discord" as const,
              owner: "owner" as const,
              connectionId: input.connectionId ?? "legacy-discord",
              conversation: input.discordThreadId,
            }
          : null;
      const binding = replyTo
        ? bindings.find((b) => sameDestination(b, replyTo))
        : undefined;
      const addressed = input.sessionId
        ? state.conversations.find((c) => c.sessionId === input.sessionId)
        : undefined;
      if (input.sessionId && !addressed)
        throw new InputError("Session not found.", 404);
      if (
        addressed &&
        input.source === "discord" &&
        binding?.sessionId !== addressed.sessionId
      )
        throw new InputError("Session belongs to another Discord thread.", 403);
      const conversationId = addressed?.id ?? input.conversationId;
      // Preserve the fingerprint of pre-migration commands when addressed by UUID.
      const fingerprint = new Bun.CryptoHasher("sha256")
        .update(
          JSON.stringify([
            input.text,
            conversationId ?? null,
            input.discordThreadId ?? null,
          ]),
        )
        .digest("hex");
      const existing = state.turns.find((t) => t.requestKey === requestKey);
      if (existing) {
        if (
          input.source === "discord" &&
          (!replyTo ||
            !existing.replyTo ||
            !sameDestination(replyTo, existing.replyTo))
        )
          throw new InputError(
            "Event belongs to another Discord connection or thread.",
            403,
          );
        if (existing.fingerprint !== fingerprint)
          throw new InputError(
            "Event ID already used for different content.",
            409,
          );
        return {
          id: existing.id,
          conversationId: existing.conversationId,
          sessionId: state.conversations.find(
            (c) => c.id === existing.conversationId,
          )!.sessionId,
        };
      }
      let conversation = conversationId
        ? state.conversations.find((c) => c.id === conversationId)
        : binding
          ? state.conversations.find((c) => c.sessionId === binding.sessionId)
          : undefined;
      if (conversationId && !conversation)
        throw new InputError("Conversation not found.", 404);
      if (!conversation) {
        const created = await tx.createConversation({
          ownership: { kind: "ownerless" },
        });
        conversation = {
          id: created.id,
          sessionId: newSessionId(),
          title: input.text.trim().slice(0, 70),
          createdAt: Date.now(),
        };
        state.conversations.push(conversation);
      }
      if (replyTo && !binding)
        bindings.push({ ...replyTo, sessionId: conversation.sessionId });
      await configure(tx, conversation.id as ConversationId, {
        model,
        tools: this.app.options.mcp ? null : [],
        instructions:
          'You are Raphie, a concise and thoughtful personal assistant. Use conversation history. You have no built-in tasks, reminders, or cross-conversation memory. Use available MCP tools for connected integrations, and never claim an external action succeeded without a confirming tool result. For Executor, read mcp_executor_skills(name="execute") before using execute. Follow its discovery workflow. The application pauses execution for owner approval; ordinary chat text is not an approval. Never automatically repeat an uncertain, rejected, or expired call. If Executor pauses for an interaction, explain it and use resume only when the owner has supplied the required response.',
      });
      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        requestKey,
        fingerprint,
        conversationId: conversation.id,
        source: input.source,
        text: input.text,
        createdAt: Date.now(),
        status: "pending",
        answer: null,
        replyTo,
      };
      state.turns.push(turn);
      record(await tx.doc(Activity), "run.accepted", "Message accepted", {
        conversationId: conversation.id,
        runId: turn.id,
        details: { source: input.source, text: turn.text, model },
      });
      await tx.createTask(
        chatWorkflow,
        {
          turnId: turn.id,
          conversationId: conversation.id as ConversationId,
          text: turn.text,
        },
        { ownership: { kind: "conversation" } },
      );
      return {
        id: turn.id,
        conversationId: conversation.id,
        sessionId: conversation.sessionId,
      };
    }, context);
    await this.app.observations.attach(result.conversationId);
    this.app.harness.resume();
    return result;
  }

  async claimDelivery() {
    return this.app.root.commit(async (tx) => {
      const next = (await tx.doc(Chats)).deliveries.find(
        (d) => d.status === "pending",
      );
      if (!next) return null;
      next.status = "sending";
      return { ...next };
    }, context);
  }

  async settleDelivery(id: string, status: "sent" | "uncertain") {
    await this.app.root.commit(async (tx) => {
      (await tx.doc(Chats)).deliveries.find((d) => d.id === id)!.status =
        status;
    }, context);
  }
}
