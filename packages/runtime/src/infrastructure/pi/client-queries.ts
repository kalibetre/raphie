import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  SessionActivity,
  SessionSummary,
  SessionTurn,
  SessionApproval,
  SessionObservation,
} from "@raphie/contracts";

import type {
  ActorContext,
  ActorAuthority,
} from "../../application/access/actors.ts";
import type { ClientQueries } from "../../application/queries/ports.ts";
import { Activity } from "../../domains/activity/infrastructure/pi-activity-journal.ts";
import type { McpTools } from "../../domains/approvals/infrastructure/mcp-approval-gate.ts";
import type { ToolApprovalService } from "../../domains/approvals/infrastructure/pi-tool-approvals.ts";
import { ChannelBindings } from "../../domains/channels/infrastructure/pi-bindings.ts";
import type { ChatService } from "../../domains/conversations/infrastructure/pi-conversation-service.ts";
import type { Observations } from "../../domains/conversations/infrastructure/pi-observations.ts";
import { InputError } from "../../shared/application/input-error.ts";
import type { DurableContext } from "../../shared/infrastructure/durable-context.ts";

type QuerySource = DurableContext & {
  actors: ActorAuthority;
  chats: ChatService;
  toolApprovals: ToolApprovalService;
  observations: Observations;
  options: { mcp?: McpTools; mcpError?: boolean };
};

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

  private async visible(actor: ActorContext) {
    this.app.actors.require(actor);
    const chats = await this.app.chats.state();
    if (actor.source !== "discord") return chats;
    const bindings = (await this.app.harness.snapshot(
      ChannelBindings,
      context,
    ))!.bindings;
    const allowed = new Set(
      bindings
        .filter(
          (b) =>
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
    if (actor.source === "discord")
      throw new InputError("Inspection requires a client interface.", 403);
    const tools = await this.app.toolApprovals.state();
    return {
      model: this.app.chats.model ?? null,
      mcp: {
        connected: !!this.app.options.mcp,
        error: this.app.options.mcpError ?? false,
        server: this.app.options.mcp?.client.server?.name ?? null,
        toolCount: this.app.options.mcp?.client.tools.length ?? 0,
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
          failed: latest?.status === "error",
          preview: (latest?.answer ?? latest?.text ?? "No messages yet").slice(
            0,
            280,
          ),
          turnCount: turns.length,
          waiting: tools.approvals.some(
            (a) =>
              a.conversationId === c.id &&
              a.status === "pending" &&
              a.expiresAt > Date.now(),
          ),
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id));
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
      text: t.text,
      createdAt: t.createdAt,
      status: t.status,
      answer: t.answer,
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
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        status: a.status,
        decidedVia: a.decidedVia,
        execution: a.execution,
      }));
  }

  async activity(actor: ActorContext, before?: string, limit = 100) {
    const size = pageSize(limit);
    this.app.actors.require(actor);
    if (actor.source === "discord")
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
        failed: last?.status === "error",
        preview: (last?.answer ?? last?.text ?? "No messages yet").slice(
          0,
          280,
        ),
        turnCount: chats.turns.filter((t) => t.conversationId === session.id)
          .length,
        waiting,
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
      live,
      activity,
      phase: waiting
        ? "approval"
        : !pending.length
          ? last?.status === "error"
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
        last?.status === "error"
          ? {
              code: "reply_failed",
              message: "Raphie could not complete this reply.",
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
