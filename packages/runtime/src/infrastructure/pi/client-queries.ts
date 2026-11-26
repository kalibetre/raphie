import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  SessionActivity,
  SessionApproval,
  SessionAsk,
  SessionCard,
  SessionObservation,
  SessionSummary,
  SessionTurn,
} from "@raphie/contracts";

import type {
  ActorAuthority,
  ActorContext,
} from "../../application/access/actors.ts";
import type { ClientQueries } from "../../application/queries/ports.ts";
import { Activity } from "../../domains/activity/infrastructure/pi-activity-journal.ts";
import type { McpTools } from "../../domains/approvals/infrastructure/mcp-approval-gate.ts";
import type { ToolApprovalService } from "../../domains/approvals/infrastructure/pi-tool-approvals.ts";
import type { Ask } from "../../domains/asks/domain/ask.ts";
import type { AskService } from "../../domains/asks/infrastructure/pi-asks.ts";
import type { CardService } from "../../domains/cards/infrastructure/pi-cards.ts";
import { ChannelBindings } from "../../domains/channels/infrastructure/pi-bindings.ts";
import type { ChatService } from "../../domains/conversations/infrastructure/pi-conversation-service.ts";
import type { Observations } from "../../domains/conversations/infrastructure/pi-observations.ts";
import { InputError } from "../../shared/application/input-error.ts";
import type { DurableContext } from "../../shared/infrastructure/durable-context.ts";

type QuerySource = DurableContext & {
  actors: ActorAuthority;
  mcpConnections?: McpTools[];
  chats: ChatService;
  toolApprovals: ToolApprovalService;
  asks: AskService;
  cards: CardService;
  observations: Observations;
  options: {
    mcp?: McpTools;
    mcpError?: boolean;
    identity?: { id: string; directory: string; kind?: "fixture" };
  };
};

/** A question still waits while it is unexpired and its turn is running. */
function waitingFor(ask: Ask, turn?: { status: string }) {
  return (
    ask.status === "pending" &&
    ask.expiresAt > Date.now() &&
    turn?.status === "pending"
  );
}

function pageSize(limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new InputError("Page size must be 1–100.");
  return limit;
}

export class PiClientQueries implements ClientQueries {
  private readonly app: QuerySource;

  constructor(app: QuerySource) {
    this.app = app;
  }

  private async bindings() {
    return (await this.app.harness.snapshot(ChannelBindings, context))!
      .bindings;
  }

  private async visible(actor: ActorContext) {
    this.app.actors.require(actor);
    const chats = await this.app.chats.state();
    if (actor.source === "web") return chats;
    const bindings = await this.bindings();
    const allowed = new Set(
      bindings
        .filter(
          (b) =>
            b.provider === actor.source &&
            b.connectionId === actor.connectionId &&
            b.conversation === actor.threadId &&
            b.owner === actor.subject,
        )
        .map((b) => b.sessionId),
    );
    return {
      ...chats,
      conversations: chats.conversations.filter((c) =>
        allowed.has(c.sessionId),
      ),
    };
  }

  async info(actor: ActorContext) {
    this.app.actors.require(actor);
    if (actor.source !== "web")
      throw new InputError("Inspection requires a client interface.", 403);
    const tools = await this.app.toolApprovals.state();
    const connections =
      this.app.mcpConnections ??
      (this.app.options.mcp ? [this.app.options.mcp] : []);
    return {
      model: this.app.chats.model ?? null,
      identity: this.app.options.identity,
      mcp: {
        connected: connections.length > 0,
        error: this.app.options.mcpError ?? false,
        server:
          connections.map((c) => c.client.server?.name ?? "MCP").join(", ") ||
          null,
        toolCount: connections.reduce(
          (count, c) => count + c.client.tools.length,
          0,
        ),
      },
      uncertainToolDeliveries: tools.deliveries
        .filter((d) => d.status === "uncertain")
        .map((d) => d.approvalId),
    };
  }

  async sessions(actor: ActorContext, after?: string, limit = 50) {
    const size = pageSize(limit);
    const chats = await this.visible(actor);
    const tools = await this.app.toolApprovals.state();
    const asks = (await this.app.asks.state()).asks;
    const items: SessionSummary[] = chats.conversations
      .map((c) => {
        const turns = chats.turns.filter((t) => t.conversationId === c.id);
        const latest = turns.at(-1);
        return {
          id: c.sessionId,
          origin: turns[0]?.source ?? "web",
          sessionId: c.sessionId,
          title: c.title,
          createdAt: c.createdAt,
          lastAt: latest?.createdAt ?? c.createdAt,
          working: turns.some((t) => t.status === "pending"),
          failed: latest?.status === "error" && !latest.cancelled,
          preview: (latest?.answer ?? latest?.text ?? "No messages yet").slice(
            0,
            280,
          ),
          turnCount: turns.length,
          replyCount: turns.filter(
            (t) => t.status === "done" && t.answer !== null,
          ).length,
          readReplyCount: c.readReplyCount ?? 0,
          ...(c.handedOffBy ? { handedOffBy: { ...c.handedOffBy } } : {}),
          ...(c.chat ? { chat: true as const } : {}),
          replyPreview:
            turns
              .findLast((t) => t.status === "done" && t.answer !== null)
              ?.answer?.slice(0, 280) ?? "",
          replyTurnId: turns.findLast(
            (t) => t.status === "done" && t.answer !== null,
          )?.id,
          waiting: tools.approvals.some(
            (a) =>
              a.conversationId === c.id &&
              a.status === "pending" &&
              a.expiresAt > Date.now(),
          ),
          asking: asks.some(
            (a) =>
              a.conversationId === c.id &&
              waitingFor(
                a,
                turns.find((t) => t.id === a.turnId),
              ),
          ),
        };
      })
      // The chat first, so a client always has it on the first page.
      .sort(
        (a, b) =>
          Number(!!b.chat) - Number(!!a.chat) ||
          b.lastAt - a.lastAt ||
          a.id.localeCompare(b.id),
      );
    const start = after ? items.findIndex((s) => s.sessionId === after) + 1 : 0;
    if (after && !start)
      throw new InputError("Session page anchor not found.", 404);
    const result = items.slice(start, start + size);
    return {
      items: result,
      next: start + size < items.length ? result.at(-1)!.sessionId : null,
    };
  }

  private async selected(actor: ActorContext, id: string) {
    const chats = await this.visible(actor);
    const session = chats.conversations.find((c) => c.sessionId === id);
    if (!session) throw new InputError("Session not found.", 404);
    return { chats, session };
  }

  async history(actor: ActorContext, id: string, before?: string, limit = 50) {
    const size = pageSize(limit);
    const { chats, session } = await this.selected(actor, id);
    const turns = chats.turns.filter((t) => t.conversationId === session.id);
    const end = before ? turns.findIndex((t) => t.id === before) : turns.length;
    if (end < 0) throw new InputError("History page anchor not found.", 404);
    const start = Math.max(0, end - size);
    const items: SessionTurn[] = turns.slice(start, end).map((t) => ({
      id: t.id,
      conversationId: id,
      source: t.source,
      ...(t.origin ? { origin: t.origin } : {}),
      text: t.text,
      ...(t.attachments?.length ? { attachments: t.attachments } : {}),
      createdAt: t.createdAt,
      status: t.status,
      answer: t.answer,
      queueMode: t.queueMode,
      cancelled: t.cancelled,
      ...(t.failure ? { failure: t.failure } : {}),
      ...(t.scheduled
        ? { scheduled: t.scheduled, scheduledDelivery: t.scheduledDelivery }
        : {}),
      ...(t.handoff ? { handoff: t.handoff } : {}),
      ...(t.readSessions?.length ? { readSessions: t.readSessions } : {}),
      ...(t.compaction ? { compaction: t.compaction } : {}),
      ...(t.quote ? { quote: t.quote } : {}),
    }));
    return { items, next: start > 0 ? items[0]!.id : null };
  }

  async approvals(actor: ActorContext, id: string): Promise<SessionApproval[]> {
    const { session } = await this.selected(actor, id);
    return (await this.app.toolApprovals.state()).approvals
      .filter((a) => a.conversationId === session.id)
      .slice(-100)
      .map((a) => ({
        id: a.id,
        conversationId: id,
        server: a.server,
        tool: a.tool,
        argumentsJson: a.argumentsJson,
        connectionIdentity: a.connectionIdentity,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        status: a.status,
        decidedVia: a.decidedVia,
        ...(a.decidedApp ? { decidedApp: a.decidedApp } : {}),
        ...(a.eachCall ? { eachCall: true as const } : {}),
        execution: a.execution,
      }));
  }

  async asks(actor: ActorContext, id: string): Promise<SessionAsk[]> {
    const { chats, session } = await this.selected(actor, id);
    return (await this.app.asks.state()).asks
      .filter((a) => a.conversationId === session.id)
      .slice(-100)
      .map((a) => ({
        id: a.id,
        conversationId: id,
        turnId: a.turnId,
        question: a.question,
        options: a.options.map((o) => ({ ...o })),
        ...(a.danger ? { danger: true as const } : {}),
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        // A question whose turn stopped can no longer be answered.
        status:
          a.status === "pending" &&
          !waitingFor(
            a,
            chats.turns.find((t) => t.id === a.turnId),
          )
            ? ("expired" as const)
            : a.status,
        answer: a.answer ? { ...a.answer } : null,
        answeredVia: a.answeredVia,
        ...(a.answeredApp ? { answeredApp: a.answeredApp } : {}),
      }));
  }

  async cards(actor: ActorContext, id: string): Promise<SessionCard[]> {
    const { session } = await this.selected(actor, id);
    return (await this.app.cards.state()).cards
      .filter((c) => c.conversationId === session.id)
      .slice(-100)
      .map((c) => ({
        id: c.id,
        conversationId: id,
        turnId: c.turnId,
        createdAt: c.createdAt,
        card: c.card,
      }));
  }

  async activity(actor: ActorContext, before?: string, limit = 100) {
    const size = pageSize(limit);
    this.app.actors.require(actor);
    if (actor.source !== "web")
      throw new InputError("Inspection requires a client interface.", 403);
    const chats = await this.app.chats.state();
    const ids = new Map(chats.conversations.map((c) => [c.id, c.sessionId]));
    const events = (await this.app.harness.snapshot(Activity, context))!.events;
    const end = before
      ? events.findIndex((e) => String(e.id) === before)
      : events.length;
    if (end < 0)
      throw new InputError(
        "Activity page anchor is no longer retained. Reload from current state.",
        409,
      );
    const start = Math.max(0, end - size);
    const items: SessionActivity[] = events.slice(start, end).map((e) => ({
      ...e,
      conversationId: e.conversationId
        ? (ids.get(e.conversationId) ?? null)
        : null,
    }));
    return { items, next: start ? String(items[0]!.id) : null };
  }

  async session(actor: ActorContext, id: string): Promise<SessionObservation> {
    const { chats, session } = await this.selected(actor, id);
    const history = await this.history(actor, id);
    const toolApprovals = await this.approvals(actor, id);
    const asks = await this.asks(actor, id);
    const asking = asks.some((a) => a.status === "pending");
    const cards = await this.cards(actor, id);
    const journal = (await this.app.harness.snapshot(Activity, context))!
      .events;
    const activity = journal
      .filter((e) => e.conversationId === session.id)
      .slice(-200)
      .map((e) => ({ ...e, conversationId: id }));
    const live = this.app.observations.live.get(session.id) ?? null;
    const pending = chats.turns.filter(
      (t) => t.conversationId === session.id && t.status === "pending",
    );
    const last = chats.turns.findLast((t) => t.conversationId === session.id);
    const waiting = toolApprovals.some(
      (a) => a.status === "pending" && a.expiresAt > Date.now(),
    );
    const latest = activity.findLast((e) =>
      /^(model|tool)\.(started|completed|retry)$/.test(e.type),
    );
    return {
      session: {
        model: session.model,
        id,
        origin:
          chats.turns.find((t) => t.conversationId === session.id)?.source ??
          "web",
        sessionId: id,
        title: session.title,
        createdAt: session.createdAt,
        lastAt: last?.createdAt ?? session.createdAt,
        working: !!pending.length,
        failed: last?.status === "error" && !last.cancelled,
        preview: (last?.answer ?? last?.text ?? "No messages yet").slice(
          0,
          280,
        ),
        turnCount: chats.turns.filter((t) => t.conversationId === session.id)
          .length,
        replyCount: chats.turns.filter(
          (t) =>
            t.conversationId === session.id &&
            t.status === "done" &&
            t.answer !== null,
        ).length,
        readReplyCount: session.readReplyCount ?? 0,
        ...(session.handedOffBy
          ? { handedOffBy: { ...session.handedOffBy } }
          : {}),
        ...(session.chat ? { chat: true as const } : {}),
        replyPreview:
          chats.turns
            .findLast(
              (t) =>
                t.conversationId === session.id &&
                t.status === "done" &&
                t.answer !== null,
            )
            ?.answer?.slice(0, 280) ?? "",
        replyTurnId: chats.turns.findLast(
          (t) =>
            t.conversationId === session.id &&
            t.status === "done" &&
            t.answer !== null,
        )?.id,
        waiting,
        asking,
      },
      turns:
        pending[0] && !history.items.some((t) => t.id === pending[0]!.id)
          ? [
              {
                id: pending[0].id,
                conversationId: id,
                source: pending[0].source,
                text: pending[0].text,
                createdAt: pending[0].createdAt,
                status: pending[0].status,
                answer: pending[0].answer,
              },
              ...history.items,
            ]
          : history.items,
      nextBefore: history.next,
      toolApprovals,
      asks,
      cards,
      live,
      activity,
      phase: waiting
        ? "approval"
        : asking
          ? "question"
          : !pending.length
            ? last?.status === "error" && !last.cancelled
              ? "failed"
              : "idle"
            : latest?.type === "tool.started"
              ? "tool"
              : live?.generating && live.text
                ? "writing"
                : latest
                  ? "model"
                  : "queued",
      error:
        last?.status === "error" && !last.cancelled
          ? {
              code: "reply_failed",
              message: last.failure
                ? `Raphie could not complete this reply. ${last.failure.message}`
                : "Raphie could not complete this reply.",
            }
          : null,
    };
  }

  async resolveLegacy(actor: ActorContext, id: number) {
    const { conversations } = await this.visible(actor);
    const session = conversations.find((c) => c.id === id);
    if (!session) throw new InputError("Session not found.", 404);
    return session.sessionId;
  }
}
