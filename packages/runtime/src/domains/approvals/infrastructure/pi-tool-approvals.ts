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

type ApprovalState = { approvals: ToolApproval[]; deliveries: ToolDelivery[] };

export const ToolApprovals = defineDoc<ApprovalState>({
  kind: "raphie.tool-approvals",
  version: 1,
  scope: "session",
  initial: () => ({ approvals: [], deliveries: [] }),
});

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
        if (existing.fingerprint !== proposal.fingerprint)
          throw new Error(
            "MCP connection or arguments changed. Send a new request for fresh approval.",
          );
        return { ...existing };
      }
      const item: ToolApproval = {
        ...proposal,
        id: crypto.randomUUID(),
        taskId: api.taskId,
        conversationId: api.conversationId,
        replyTo:
          chats.turns.find(
            (t) =>
              t.conversationId === api.conversationId && t.status === "pending",
          )?.replyTo ?? null,
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.app.options.approvalTtlMs ?? 600_000),
        status: "pending",
        decidedVia: null,
        execution: "waiting",
        result: null,
      };
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
      notify(
        state,
        item,
        "approval",
        chats.turns.find(
          (t) =>
            t.conversationId === item.conversationId && t.status === "pending",
        )?.replyTo?.conversation ?? null,
      );
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
        watch.start(async (state) => inspect(state));
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
  ) {
    this.app.authorize(actor);
    if (!isDecision(decision)) throw new InputError("Invalid decision.");
    return this.app.root.commit(async (tx) => {
      const state = await tx.doc(ToolApprovals);
      const item = state.approvals.find((a) => a.id === id);
      if (!item) throw new InputError("Tool approval not found.", 404);
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
      if (item.status !== "pending") return item.status;
      item.status = decideApproval(
        item.status,
        item.expiresAt,
        decision,
        Date.now(),
      );
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
