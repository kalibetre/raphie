import { createHash, randomUUID } from 'node:crypto';
import { configure, defineDoc, defineTask } from '@earendil-works/pi-durable';
import type { ModelRef, ConversationId } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Gateway } from './gateway.ts';
import type { Source } from './state.ts';
import { InputError } from './state.ts';

export type ChatConversation = { id: ConversationId; title: string; discordThreadId: string | null; createdAt: number };
export type ChatTurn = {
  id: string; requestKey: string; fingerprint: string; conversationId: ConversationId; source: Source;
  text: string; createdAt: number; status: 'pending' | 'done' | 'error'; answer: string | null;
};
export type ChatDelivery = {
  id: string; turnId: string; threadId: string; text: string;
  status: 'pending' | 'sending' | 'sent' | 'uncertain';
};
type ChatState = { conversations: ChatConversation[]; turns: ChatTurn[]; deliveries: ChatDelivery[] };
export const Chats = defineDoc<ChatState>({ kind: 'raphie.chats', version: 1, scope: 'session',
  initial: () => ({ conversations: [], turns: [], deliveries: [] }) });

export const chatWorkflow = defineTask<{ turnId: string; conversationId: ConversationId; text: string }, { phase: 'reply' }, null>({
  name: 'raphie.chat-reply', version: 1, initial: () => ({ phase: 'reply' }),
  phases: { reply: async (task, runtime, ctx) => {
    const conversation = await runtime.conversation(task.input.conversationId, ctx);
    if (!conversation) throw new Error('Chat conversation not found.');
    // Durable admission key closes the crash window between submit and waiting.
    const submission = await conversation.submit({ type: 'input', content: task.input.text,
      requestId: task.input.turnId, whenBusy: 'followUp' }, ctx);
    const settled = await submission.wait(ctx);
    await runtime.commit(async tx => {
      const entry = settled.type === 'input' && settled.status === 'done' ? await tx.entry(settled.answer) : undefined;
      const answer = entry?.model?.flatMap(message => message.role === 'assistant'
        ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('\n') || null;
      const state = await tx.doc(Chats);
      const turn = state.turns.find(t => t.id === task.input.turnId)!;
      turn.status = answer ? 'done' : 'error'; turn.answer = answer;
      const destination = state.conversations.find(c => c.id === turn.conversationId)!.discordThreadId;
      if (destination) {
        const text = answer ?? 'I could not complete that reply. Check the model configuration and send a new message to retry.';
        // Discord has a 2,000-character content limit. Each chunk has its own durable claim.
        for (let start = 0; start < text.length; start += 1900) state.deliveries.push({
          id: `${turn.id}:${start}`, turnId: turn.id, threadId: destination, text: text.slice(start, start + 1900), status: 'pending',
        });
      }
      return { status: 'terminal', outcome: { status: 'completed', result: null } };
    }, ctx);
  } },
  abort: async (_task, runtime, ctx) => {
    await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx);
  },
});

export class ChatService {
  app: Gateway;
  model: ModelRef | undefined;
  constructor(app: Gateway, model?: ModelRef) { this.app = app; this.model = model; }
  async state() { return (await this.app.harness.snapshot(Chats, context))!; }

  async send(input: { source: Source; eventId: string; actor: string; text: string; conversationId?: ConversationId; discordThreadId?: string }) {
    this.app.authorize(input.actor);
    if (!this.model) throw new InputError('Chat needs OPENROUTER_API_KEY and RAPHIE_MODEL configured on the server.', 503);
    if (!input.eventId || input.eventId.length > 200 || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
      throw new InputError('Send a message of 1–4,000 characters with a stable event ID.');
    }
    const model = this.model;
    const requestKey = `${input.source}:${input.eventId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([input.text, input.conversationId ?? null, input.discordThreadId ?? null])).digest('hex');
    const result = await this.app.root.commit(async tx => {
      const state = await tx.doc(Chats);
      const existing = state.turns.find(t => t.requestKey === requestKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new InputError('Event ID already used for different content.', 409);
        return { id: existing.id, conversationId: existing.conversationId };
      }
      let conversation = input.conversationId ? state.conversations.find(c => c.id === input.conversationId)
        : input.discordThreadId ? state.conversations.find(c => c.discordThreadId === input.discordThreadId) : undefined;
      if (input.conversationId && !conversation) throw new InputError('Conversation not found.', 404);
      if (!conversation) {
        const created = await tx.createConversation({ ownership: { kind: 'ownerless' } });
        conversation = { id: created.id, title: input.text.trim().slice(0, 70),
          discordThreadId: input.source === 'discord' ? input.discordThreadId ?? null : null, createdAt: Date.now() };
        state.conversations.push(conversation);
      }
      await configure(tx, conversation.id, { model, tools: [], instructions:
        'You are Raphie, a concise and thoughtful personal assistant. Use the conversation history to continue prior discussions. You currently have no tools, calendar, email, reminders, or cross-conversation memory. Never claim to have saved a task, scheduled a reminder, accessed a file, or performed an external action. Be clear about these limits when relevant.' });
      const turn: ChatTurn = { id: randomUUID(), requestKey, fingerprint, conversationId: conversation.id,
        source: input.source, text: input.text, createdAt: Date.now(), status: 'pending', answer: null };
      state.turns.push(turn);
      await tx.createTask(chatWorkflow, { turnId: turn.id, conversationId: conversation.id, text: turn.text },
        { ownership: { kind: 'conversation' } });
      return { id: turn.id, conversationId: conversation.id };
    }, context);
    this.app.harness.resume();
    return result;
  }

  async claimDelivery() {
    return this.app.root.commit(async tx => {
      const next = (await tx.doc(Chats)).deliveries.find(d => d.status === 'pending');
      if (!next) return null;
      next.status = 'sending'; return { ...next };
    }, context);
  }
  async settleDelivery(id: string, status: 'sent' | 'uncertain') {
    await this.app.root.commit(async tx => { (await tx.doc(Chats)).deliveries.find(d => d.id === id)!.status = status; }, context);
  }
}
