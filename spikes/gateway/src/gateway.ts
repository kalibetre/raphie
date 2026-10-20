import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import type { Conversation } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Files } from './files.ts';
import type { FileRef } from './files.ts';
import { State, InputError } from './state.ts';
import type { Approval, Source } from './state.ts';
import { deliveryWorkflow, enqueue } from './workflow.ts';
import { Chats, ChatService, chatWorkflow } from './chats.ts';
import type { ModelRef } from '@earendil-works/pi-durable';
import type { Models } from '@earendil-works/pi-ai/models';
import { ToolApprovals, ToolApprovalService } from './tool-approvals.ts';
import { createMcpTools } from './mcp-tools.ts';
import type { McpTools } from './mcp-tools.ts';

type Options = {
  directory: string; discordThreadId?: string; approvalTtlMs?: number;
  beforeEffectCommit?: () => Promise<void>;
  models?: Models; model?: ModelRef;
  mcp?: McpTools;
  mcpError?: boolean;
};
export class Gateway {
  files: Files;
  harness!: Harness;
  root!: Conversation;
  options: Options;
  workflow: ReturnType<typeof deliveryWorkflow>;
  chats: ChatService;
  toolApprovals: ToolApprovalService;

  private constructor(options: Options) {
    this.options = options;
    this.files = new Files(join(options.directory, 'files'));
    this.workflow = deliveryWorkflow(this.files, options.discordThreadId ?? null, options.beforeEffectCommit);
    this.chats = new ChatService(this, options.model);
    this.toolApprovals = new ToolApprovalService(this);
  }

  static async open(options: Options) {
    const app = new Gateway(options);
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'raphie.gateway', tasks: [app.workflow, chatWorkflow] }));
    if (options.mcp) registry.install(createMcpTools(app, options.mcp));
    app.harness = await Harness.open(await openNodeSqliteStorage(join(options.directory, 'gateway.sqlite')),
      { registry, models: options.models ?? createModels(), settings: {
        followUpMode: 'one-at-a-time', stream: { timeoutMs: 120_000 }, retry: { enabled: true, maxRetries: 1 },
      } }, context);
    app.root = await app.harness.root(context);
    await app.root.commit(async tx => {
      const state = await tx.doc(State);
      // Sending may have succeeded before the process died. Never blindly resend it.
      for (const delivery of state.deliveries) if (delivery.status === 'sending') {
        delivery.status = 'uncertain'; delivery.error = 'Interrupted during delivery; check Discord before retrying.';
      }
      const chats = await tx.doc(Chats);
      for (const delivery of chats.deliveries) if (delivery.status === 'sending') delivery.status = 'uncertain';
      const toolApprovals = await tx.doc(ToolApprovals);
      for (const item of toolApprovals.approvals) if (item.execution === 'running') item.execution = 'uncertain';
      for (const delivery of toolApprovals.deliveries) if (delivery.status === 'sending') delivery.status = 'uncertain';
    }, context);
    app.harness.resume();
    return app;
  }

  async state() { return (await this.harness.snapshot(State, context))!; }
  async close() { await this.harness.close(context); }

  async accept(input: { source: Source; eventId: string; actor: string; text: string; files: FileRef[]; discordThreadId?: string }) {
    this.authorize(input.actor);
    if (!input.eventId || input.eventId.length > 200) throw new InputError('A stable event ID is required.');
    if (typeof input.text !== 'string' || input.text.length > 4000 || (!input.text.trim() && !input.files.length)) {
      throw new InputError('Write a message (up to 4,000 characters) or attach a file.');
    }
    if (input.files.length > 4) throw new InputError('Attach at most four files.');
    const requestKey = `${input.source}:${input.eventId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([input.text, input.files])).digest('hex');
    const id = await this.root.commit(async tx => {
      const state = await tx.doc(State);
      const existing = state.approvals.find(a => a.requestKey === requestKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new InputError('Event ID already used for different content.', 409);
        return existing.id;
      }
      const now = Date.now();
      const approval: Approval = {
        id: randomUUID(), requestKey, fingerprint, text: input.text, files: input.files,
        source: input.source, createdAt: now, expiresAt: now + (this.options.approvalTtlMs ?? 600_000),
        status: 'pending', decidedVia: null, completedAt: null, results: [], effectCount: 0,
      };
      await tx.createTask(this.workflow, { approvalId: approval.id },
        { ownership: { kind: 'conversation' } });
      state.approvals.push(approval);
      enqueue(state, approval, 'approval', input.source === 'discord'
        ? input.discordThreadId ?? this.options.discordThreadId ?? null
        : this.options.discordThreadId ?? null);
      return approval.id;
    }, context);
    this.harness.resume();
    return id;
  }

  async decide(id: string, decision: 'approved' | 'rejected', actor: string, via: Source) {
    this.authorize(actor);
    if (decision !== 'approved' && decision !== 'rejected') throw new InputError('Invalid decision.');
    return this.root.commit(async tx => {
      const state = await tx.doc(State);
      const approval = state.approvals.find(a => a.id === id);
      if (!approval) throw new InputError('Approval not found.', 404);
      if (approval.status !== 'pending') return approval.status;
      approval.status = Date.now() >= approval.expiresAt ? 'expired' : decision;
      approval.decidedVia = via;
      enqueue(state, approval, 'resolved', this.options.discordThreadId ?? null);
      return approval.status;
    }, context);
  }

  authorize(actor: string) { if (actor !== 'owner') throw new InputError('Not authorized.', 403); }

  /** Serial delivery pump calls these around the network operation. */
  async claimDelivery() {
    return this.root.commit(async tx => {
      const state = await tx.doc(State);
      const next = state.deliveries.find(d => d.status === 'pending');
      if (!next) return null;
      next.status = 'sending';
      return { ...next };
    }, context);
  }

  async settleDelivery(id: string, messageId: string | null, error: string | null = null) {
    await this.root.commit(async tx => {
      const delivery = (await tx.doc(State)).deliveries.find(d => d.id === id)!;
      delivery.status = error ? 'uncertain' : 'sent';
      delivery.messageId = messageId; delivery.error = error;
    }, context);
  }
}
