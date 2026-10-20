import { randomUUID } from 'node:crypto';
import { defineDoc } from '@earendil-works/pi-durable';
import type { ConversationId, ToolExecutionApi } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Gateway } from './gateway.ts';
import type { Source } from './state.ts';
import { InputError } from './state.ts';
import { Chats } from './chats.ts';

export type ToolResult = { text: string; isError: boolean };
export type ToolApproval = {
  id: string; taskId: number; conversationId: ConversationId; fingerprint: string;
  server: string; tool: string; argumentsJson: string; createdAt: number; expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired'; decidedVia: Source | null;
  execution: 'waiting' | 'running' | 'done' | 'uncertain'; result: ToolResult | null;
};
export type ToolDelivery = { id: string; approvalId: string; threadId: string; kind: 'approval' | 'resolved';
  status: 'pending' | 'sending' | 'sent' | 'uncertain'; messageId: string | null };
type ApprovalState = { approvals: ToolApproval[]; deliveries: ToolDelivery[] };
export const ToolApprovals = defineDoc<ApprovalState>({ kind: 'raphie.tool-approvals', version: 1, scope: 'session',
  initial: () => ({ approvals: [], deliveries: [] }) });

function notify(state: ApprovalState, item: ToolApproval, kind: ToolDelivery['kind'], threadId: string | null) {
  if (threadId && !state.deliveries.some(d => d.id === `${item.id}:${kind}`)) state.deliveries.push({
    id: `${item.id}:${kind}`, approvalId: item.id, threadId, kind, status: 'pending', messageId: null,
  });
}

export class ToolApprovalService {
  app: Gateway;
  constructor(app: Gateway) { this.app = app; }
  async state() { return (await this.app.harness.snapshot(ToolApprovals, context))!; }

  async ensure(api: ToolExecutionApi, ctx: Context, proposal: { fingerprint: string; server: string; tool: string; argumentsJson: string }) {
    return api.commit(async tx => {
      const state = await tx.doc(ToolApprovals);
      const chats = await tx.doc(Chats);
      const existing = state.approvals.find(a => a.taskId === api.taskId);
      if (existing) {
        if (existing.fingerprint !== proposal.fingerprint) throw new Error('MCP connection or arguments changed. Send a new request for fresh approval.');
        return { ...existing };
      }
      const item: ToolApproval = { ...proposal, id: randomUUID(), taskId: api.taskId, conversationId: api.conversationId,
        createdAt: Date.now(), expiresAt: Date.now() + (this.app.options.approvalTtlMs ?? 600_000),
        status: 'pending', decidedVia: null, execution: 'waiting', result: null };
      state.approvals.push(item);
      notify(state, item, 'approval', chats.conversations.find(c => c.id === item.conversationId)?.discordThreadId ?? null);
      return { ...item };
    }, ctx);
  }

  async wait(api: ToolExecutionApi, ctx: Context, item: ToolApproval) {
    const watch = await api.watchDoc(ToolApprovals, ctx);
    if (!watch) throw new Error('Missing tool approvals.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); ctx.abortSignal?.removeEventListener('abort', abort); resolve(); };
        abort = () => { clearTimeout(timer); reject(new Error('Tool approval wait interrupted.')); };
        const inspect = (state: Readonly<ApprovalState> | null) => {
          if (state?.approvals.find(a => a.id === item.id)?.status !== 'pending') done();
        };
        ctx.abortSignal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(done, Math.max(0, item.expiresAt - Date.now()));
        watch.start(async state => inspect(state)); inspect(watch.value);
        if (ctx.abortSignal?.aborted) abort();
      });
    } finally { clearTimeout(timer); ctx.abortSignal?.removeEventListener('abort', abort); await watch.stop(); }
    return api.commit(async tx => {
      const state = await tx.doc(ToolApprovals);
      const current = state.approvals.find(a => a.id === item.id)!;
      if (current.status === 'pending') {
        current.status = 'expired';
        notify(state, current, 'resolved', state.deliveries.find(d => d.approvalId === item.id)?.threadId ?? null);
      }
      return { ...current };
    }, ctx);
  }

  async decide(id: string, decision: 'approved' | 'rejected', actor: string, via: Source, threadId?: string) {
    this.app.authorize(actor);
    if (!['approved', 'rejected'].includes(decision)) throw new InputError('Invalid decision.');
    return this.app.root.commit(async tx => {
      const state = await tx.doc(ToolApprovals);
      const item = state.approvals.find(a => a.id === id);
      if (!item) throw new InputError('Tool approval not found.', 404);
      const destination = state.deliveries.find(d => d.approvalId === id)?.threadId ?? null;
      if (via === 'discord' && destination !== threadId) throw new InputError('Approval belongs to another Discord thread.', 403);
      if (item.status !== 'pending') return item.status;
      item.status = Date.now() >= item.expiresAt ? 'expired' : decision; item.decidedVia = via;
      notify(state, item, 'resolved', destination);
      return item.status;
    }, context);
  }

  async claimDelivery() {
    return this.app.root.commit(async tx => {
      const next = (await tx.doc(ToolApprovals)).deliveries.find(d => d.status === 'pending');
      if (!next) return null;
      next.status = 'sending'; return { ...next };
    }, context);
  }
  async settleDelivery(id: string, messageId: string | null) {
    await this.app.root.commit(async tx => {
      const item = (await tx.doc(ToolApprovals)).deliveries.find(d => d.id === id)!;
      item.status = messageId ? 'sent' : 'uncertain'; item.messageId = messageId;
    }, context);
  }
}
