import { decideApproval, isDecision } from "../domain/decision.ts";
import type { ToolApproval, ToolDelivery } from "../domain/tool-approval.ts";

export type { ToolApproval, ToolResult } from "../domain/tool-approval.ts";

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { defineDoc } from "@earendil-works/pi-durable";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { Source } from "./pi-file-approvals.ts";
import { InputError } from "./pi-file-approvals.ts";

type Grant = {
  id: string;
  conversationId: number;
  connectionIdentity: string;
  tool: string;
  argumentsJson?: string;
  actor: string;
  revoked: boolean;
};

type ApprovalState = {
  // Legacy MCP policy is deliberately never used for command authorization.
  modes?: Record<string, "ask" | "full-access">;
  commandModes?: Record<string, "ask" | "full-access">;
  grants?: Grant[];
  approvals: ToolApproval[];
  deliveries: ToolDelivery[];
};

export const ToolApprovals = defineDoc<ApprovalState>({
  kind: "raphie.tool-approvals",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ approvals: [], deliveries: [] }),
});

export function supportsCommandGrant(item: Pick<ToolApproval, "server" | "tool" | "connectionIdentity">) {
  return item.server === "workspace" && item.connectionIdentity === "raphie.workspace.command" && (item.tool === "bash" || item.tool === "workspace_exec");
}

export function activeCommandGrant(state: ApprovalState, item: ToolApproval) {
  return !item.grantId || !!state.grants?.some(g => g.id === item.grantId && !g.revoked && supportsCommandGrant(item) && g.conversationId === item.conversationId && g.connectionIdentity === item.connectionIdentity && g.tool === item.tool && g.argumentsJson === item.argumentsJson);
}

function notify(
  state: ApprovalState,
  item: ToolApproval,
  kind: ToolDelivery["kind"],
  threadId: string | null,
) {
  if (threadId && !state.deliveries.some((d) => d.id === `${item.id}:${kind}`))
    state.deliveries.push({
      id: `${item.id}:${kind}`,
      approvalId: item.id,
      threadId,
      connectionId: item.replyTo?.connectionId,
      kind,
      status: "pending",
      messageId: null,
    });
}

export class ToolApprovalService {
  app: DurableContext;

  constructor(app: DurableContext) {
    this.app = app;
  }

  async state() {
    return (await this.app.harness.snapshot(ToolApprovals, context))!;
  }

  async ensure(
    api: ToolExecutionApi,
    ctx: Context,
    proposal: {
      fingerprint: string;
      legacyFingerprint?: string;
      connectionIdentity?: string;
      server: string;
      tool: string;
      argumentsJson: string;
    },
  ) {
    return api.commit(async (tx) => {
      const state = await tx.doc(ToolApprovals);
      const chats = await tx.doc(Chats);
      const existing = state.approvals.find((a) => a.taskId === api.taskId);
      if (existing) {
        if (
          !existing.connectionIdentity &&
          existing.conversationId === api.conversationId &&
          existing.server === proposal.server &&
          existing.tool === proposal.tool &&
          existing.argumentsJson === proposal.argumentsJson &&
          proposal.legacyFingerprint &&
          existing.fingerprint === proposal.legacyFingerprint
        ) {
          existing.fingerprint = proposal.fingerprint;
          // Keep legacy approvals ineligible for session grants.
        }
        if (existing.fingerprint !== proposal.fingerprint)
          throw new Error(
            "MCP connection or arguments changed. Send a new request for fresh approval.",
          );
        return { ...existing };
      }
      const pendingTurns = chats.turns.filter(
        (t) =>
          t.conversationId === api.conversationId && t.status === "pending",
      );
      const turn = pendingTurns[0];
      // The tool API identifies a conversation, not its originating turn. Never
      // assign authority from an ambiguous queue; the web owner can still decide.
      const initiator =
        pendingTurns.length === 1 ? turn?.discordUserId : undefined;
      const { legacyFingerprint: _legacyFingerprint, ...currentProposal } =
        proposal;
      const item: ToolApproval = {
        ...currentProposal,
        id: crypto.randomUUID(),
        taskId: api.taskId,
        conversationId: api.conversationId,
        replyTo: turn?.replyTo ?? null,
        ...(initiator ? { discordUserId: initiator } : {}),
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.app.options.approvalTtlMs ?? 600_000),
        status: "pending",
        decidedVia: null,
        execution: "waiting",
        result: null,
      };
      if (
        proposal.connectionIdentity === "raphie.workspace.command" &&
        proposal.server === "workspace" &&
        (proposal.tool === "workspace_exec" || proposal.tool === "bash") &&
        state.commandModes?.[String(api.conversationId)] === "full-access"
      ) {
        item.status = "approved";
        item.fullAccess = true;
      }
      if (supportsCommandGrant(item)) {
        const grant = state.grants?.find(g => !g.revoked && g.conversationId === item.conversationId && g.connectionIdentity === item.connectionIdentity && g.tool === item.tool && g.argumentsJson === item.argumentsJson);
        if (grant) { item.status = "approved"; item.grantId = grant.id; }
      }
      // Command permissions never authorize external MCP service calls.
      // Legacy MCP grants and modes remain readable for migration only.
      state.approvals.push(item);
      record(
        await tx.doc(Activity),
        "approval.requested",
        `Approval requested for ${item.tool}`,
        {
          conversationId: item.conversationId,
          runId: chats.turns.find(
            (t) =>
              t.conversationId === item.conversationId &&
              t.status === "pending",
          )?.id,
          operationId: item.id,
          pluginId: item.server,
          details: {
            tool: item.tool,
            arguments: JSON.parse(item.argumentsJson),
            expiresAt: item.expiresAt,
          },
        },
      );
      if (item.status === "pending") {
        notify(state, item, "approval", turn?.replyTo?.conversation ?? null);
      } else {
        record(
          await tx.doc(Activity),
          "approval.approved",
          "Tool request automatically authorized",
          {
            conversationId: item.conversationId,
            operationId: item.id,
            details: {
              grantId: item.grantId ?? null,
              fullAccess: !!item.fullAccess,
            },
          },
        );
      }
      return { ...item };
    }, ctx);
  }

  async wait(api: ToolExecutionApi, ctx: Context, item: ToolApproval) {
    const watch = await api.watchDoc(ToolApprovals, ctx);
    if (!watch) throw new Error("Missing tool approvals.");
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
          reject(new Error("Tool approval wait interrupted."));
        };
        const inspect = (state: Readonly<ApprovalState> | null) => {
          if (
            state?.approvals.find((a) => a.id === item.id)?.status !== "pending"
          )
            done();
        };
        ctx.abortSignal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(done, Math.max(0, item.expiresAt - Date.now()));
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
      const state = await tx.doc(ToolApprovals);
      const current = state.approvals.find((a) => a.id === item.id)!;
      if (current.status === "pending") {
        current.status = "expired";
        record(await tx.doc(Activity), "approval.expired", "Approval expired", {
          conversationId: current.conversationId,
          operationId: current.id,
        });
        notify(
          state,
          current,
          "resolved",
          state.deliveries.find((d) => d.approvalId === item.id)?.threadId ??
            null,
        );
      }
      return { ...current };
    }, ctx);
  }

  async decide(
    id: string,
    decision: "approved" | "rejected",
    actor: string,
    via: Source,
    threadId?: string,
    connectionId = "legacy-discord",
    discordUserId?: string,
    scope: "once" | "session" = "once",
  ) {
    this.app.authorize(actor);
    if (!isDecision(decision)) throw new InputError("Invalid decision.");
    return this.app.root.commit(async (tx) => {
      const state = await tx.doc(ToolApprovals);
      const item = state.approvals.find((a) => a.id === id);
      if (!item) throw new InputError("Tool approval not found.", 404);
      if (scope === "session" && !supportsCommandGrant(item)) throw new InputError("This tool requires approval of each call.", 403);
      const destination =
        state.deliveries.find((d) => d.approvalId === id)?.threadId ?? null;
      if (
        via === "discord" &&
        item.replyTo &&
        item.replyTo.connectionId !== connectionId
      )
        throw new InputError(
          "Approval belongs to another Discord connection.",
          403,
        );
      if (via === "discord" && destination !== threadId)
        throw new InputError(
          "Approval belongs to another Discord thread.",
          403,
        );
      if (
        via === "discord" &&
        (!item.discordUserId || item.discordUserId !== discordUserId)
      )
        throw new InputError(
          "Only the Discord user who initiated this request can decide it. Use the web UI if the initiator cannot be verified.",
          403,
        );
      if (item.status !== "pending") return item.status;
      item.status = decideApproval(
        item.status,
        item.expiresAt,
        decision,
        Date.now(),
      );
      if (item.status === "approved" && scope === "session") {
        state.grants ??= [];
        const grant = { id: crypto.randomUUID(), conversationId: item.conversationId, connectionIdentity: item.connectionIdentity!, tool: item.tool, argumentsJson: item.argumentsJson, actor, revoked: false };
        state.grants.push(grant);
        item.grantId = grant.id;
      }
      item.decidedVia = via;
      record(
        await tx.doc(Activity),
        `approval.${item.status}`,
        `Tool request ${item.status}`,
        {
          conversationId: item.conversationId,
          operationId: item.id,
          details: { via, actor },
        },
      );
      notify(state, item, "resolved", destination);
      return item.status;
    }, context);
  }

  async approvalMode(
    actor: string,
    sessionId: string,
    mode?: "ask" | "full-access",
  ) {
    this.app.authorize(actor);
    return this.app.root.commit(async (tx) => {
      const conversation = (await tx.doc(Chats)).conversations.find(
        (c) => c.sessionId === sessionId,
      );
      if (!conversation) throw new InputError("Session not found.", 404);
      const state = await tx.doc(ToolApprovals);
      if (mode !== undefined) {
        state.commandModes = {
          ...state.commandModes,
          [String(conversation.id)]: mode,
        };
        record(
          await tx.doc(Activity),
          "approval.mode_changed",
          "Command permission mode changed",
          {
            conversationId: conversation.id,
            details: { actor, mode },
          },
        );
      }
      return state.commandModes?.[String(conversation.id)] ?? "ask";
    }, context);
  }

  async listGrants(actor: string, sessionId: string) {
    this.app.authorize(actor);
    return this.app.root.commit(async (tx) => {
      const conversation = (await tx.doc(Chats)).conversations.find(
        (c) => c.sessionId === sessionId,
      );
      if (!conversation) throw new InputError("Session not found.", 404);
      return ((await tx.doc(ToolApprovals)).grants ?? [])
        .filter((g) => !g.revoked && g.conversationId === conversation.id)
        .map(({ id, tool, argumentsJson }) => ({ id, tool: argumentsJson ? `${tool}: ${argumentsJson}` : tool }));
    }, context);
  }

  async revokeGrant(actor: string, sessionId: string, id: string) {
    this.app.authorize(actor);
    await this.app.root.commit(async (tx) => {
      const conversation = (await tx.doc(Chats)).conversations.find(
        (c) => c.sessionId === sessionId,
      );
      const grant = (await tx.doc(ToolApprovals)).grants?.find(
        (g) => g.id === id && g.conversationId === conversation?.id,
      );
      if (!grant) throw new InputError("Grant not found.", 404);
      if (!grant.revoked) {
        grant.revoked = true;
        record(
          await tx.doc(Activity),
          "grant.revoked",
          "Session grant revoked",
          {
            conversationId: grant.conversationId,
            operationId: grant.id,
            details: { actor, tool: grant.tool },
          },
        );
      }
    }, context);
  }

  async claimDelivery() {
    return this.app.root.commit(async (tx) => {
      const next = (await tx.doc(ToolApprovals)).deliveries.find(
        (d) => d.status === "pending",
      );
      if (!next) return null;
      next.status = "sending";
      return { ...next };
    }, context);
  }

  async settleDelivery(id: string, messageId: string | null) {
    await this.app.root.commit(async (tx) => {
      const item = (await tx.doc(ToolApprovals)).deliveries.find(
        (d) => d.id === id,
      )!;
      item.status = messageId ? "sent" : "uncertain";
      item.messageId = messageId;
    }, context);
  }
}
