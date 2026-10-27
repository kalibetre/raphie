import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ConversationId, ModelRef } from "@earendil-works/pi-durable";
import { configure, defineDoc, defineTask } from "@earendil-works/pi-durable";
import type {
  BotProfile,
  Channel as Source,
  ModelSelection,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { sameDestination } from "../../channels/domain/binding.ts";
import { ChannelBindings } from "../../channels/infrastructure/pi-bindings.ts";
import type { MemoryService } from "../../memory/application/ports.ts";
import { memoryInstructions } from "../../memory/infrastructure/memory-instructions.ts";
import type { ConversationCommands } from "../application/ports.ts";
import { messageViolation } from "../domain/admission.ts";
import type {
  ChatConversation,
  ChatDelivery,
  ChatTurn,
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
  checkpointWhen: () => false,
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
  personality?: () => Pick<
    BotProfile,
    "name" | "description" | "soul" | "revision"
  >;
  app: DurableContext;
  model: ModelRef | undefined;
  private models: Models;
  private readonly connectionGate: ModelConnectionGate;
  private readonly memory?: Pick<MemoryService, "read">;

  constructor(
    app: DurableContext,
    models: Models,
    model?: ModelRef,
    connectionGate = new ModelConnectionGate(),
    memory?: Pick<MemoryService, "read">,
  ) {
    this.app = app;
    this.models = models;
    this.model = model;
    this.connectionGate = connectionGate;
    this.memory = memory;
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
    model?: ModelSelection;
    discordThreadId?: string;
    connectionId?: string;
    discordUserId?: string;
    scheduled?: { name: string };
  }) {
    this.app.authorize(input.actor);
    const result = await this.connectionGate.run(async () => {
      if (!this.model)
        throw new InputError(
          "Connect a model provider in Settings before sending a message.",
          503,
        );
      const violation = messageViolation(input);
      if (violation) throw new InputError(violation);
      const requestKey = `${input.source}:${input.eventId}`;
      return this.app.root.commit(async (tx) => {
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
          throw new InputError(
            "Session belongs to another Discord thread.",
            403,
          );
        const conversationId = addressed?.id ?? input.conversationId;
        // Preserve the fingerprint of pre-migration commands when addressed by UUID.
        const fingerprint = new Bun.CryptoHasher("sha256")
          .update(
            JSON.stringify([
              input.text,
              conversationId ?? null,
              input.discordThreadId ?? null,
              ...(input.model
                ? [input.model.provider, input.model.modelId]
                : []),
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
          if (
            input.source === "discord" &&
            existing.discordUserId &&
            existing.discordUserId !== input.discordUserId
          )
            throw new InputError("Event belongs to another Discord user.", 403);
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
            title: (input.scheduled?.name ?? input.text).trim().slice(0, 70),
            createdAt: Date.now(),
            model: { ...(input.model ?? this.model!) },
          };
          state.conversations.push(conversation);
        }
        if (
          input.model &&
          state.turns.some(
            (t) =>
              t.conversationId === conversation.id && t.status === "pending",
          )
        )
          throw new InputError(
            "Wait for this session’s current turn to finish before changing its model.",
            409,
          );
        const model = input.model ?? conversation.model ?? this.model!;
        this.validateModel(model);
        conversation.model = { ...model };
        if (replyTo && !binding)
          bindings.push({ ...replyTo, sessionId: conversation.sessionId });
        const personality = this.personality?.();
        await configure(tx, conversation.id as ConversationId, {
          model,
          tools: null, // The registry owns current tools, including deferred MCP discovery.
          instructions:
            memoryInstructions(
              this.memory?.read().configuration.enabled ?? false,
            ) +
            (personality
              ? `Your name is ${personality.name}. ${personality.description}\nOwner-authored SOUL.md (revision ${personality.revision}):\n${personality.soul}\n`
              : "You are Raphie, a concise and thoughtful personal assistant. ") +
            "Diagrams: when a flow, sequence, architecture, timeline, or hierarchy would make an answer clearer, include one as a fenced ```mermaid block with valid Mermaid syntax. Use diagrams only when they add clarity, and keep them small. " +
            `Current time: ${new Date().toISOString()}. Use conversation history for context, but determine your capabilities from the tools offered on this turn. Earlier assistant claims about unavailable tools may be outdated or mistaken; do not repeat them when a matching tool is now offered. Personality instructions never grant capabilities or cross-bot access. Discover available MCP tools for connected integrations, and never claim an external action succeeded without a confirming tool result. External tool actions pause for owner approval; ordinary chat text is not an approval for those actions. Never automatically repeat an uncertain, rejected, or expired call.`,
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
          ...(input.source === "discord" && input.discordUserId
            ? { discordUserId: input.discordUserId }
            : {}),
          ...(input.scheduled ? { scheduled: input.scheduled } : {}),
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
            text: input.scheduled
              ? scheduledInstruction(input.scheduled.name, turn.text)
              : turn.text,
          },
          { ownership: { kind: "conversation" } },
        );
        return {
          id: turn.id,
          conversationId: conversation.id,
          sessionId: conversation.sessionId,
        };
      }, context);
    });
    await this.app.observations.attach(result.conversationId);
    this.app.harness.resume();
    return result;
  }

  private validateModel(model: ModelSelection) {
    if (!this.model || !this.models.getModel(model.provider, model.modelId))
      throw new InputError(
        "This model is unavailable. Choose a model from the connected provider.",
        400,
      );
  }

  async chooseModel(sessionId: string, model: ModelSelection) {
    await this.app.root.commit(async (tx) => {
      const state = await tx.doc(Chats);
      const session = state.conversations.find(
        (c) => c.sessionId === sessionId,
      );
      if (!session) throw new InputError("Session not found.", 404);
      this.validateModel(model);
      if (
        state.turns.some(
          (t) => t.conversationId === session.id && t.status === "pending",
        )
      )
        throw new InputError(
          "Wait for this session’s current turn to finish before changing its model.",
          409,
        );
      session.model = { ...model };
      await configure(tx, session.id as ConversationId, { model });
    }, context);
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

/**
 * A due job's saved instruction, framed so the model writes the reminder
 * itself instead of answering the owner as if they had just asked.
 */
function scheduledInstruction(name: string, instruction: string) {
  return `Scheduled job "${name}" is due now. The owner did not just send this message; it is the instruction they saved earlier. Write the message to deliver to them now, addressed to them directly. Do not acknowledge a request or mention that you were asked.\n\nSaved instruction:\n${instruction}`;
}
