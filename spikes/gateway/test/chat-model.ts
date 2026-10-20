import { createModels } from '@earendil-works/pi-ai/models';
import type { Provider } from '@earendil-works/pi-ai/models';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

/** Deterministic provider behind the real Pi generation loop, with no network. */
export function chatModel(options: { fail?: boolean; started?: () => void; pause?: Promise<void> } = {}) {
  const models = createModels();
  const model = { ...openrouterProvider().getModels()[0], id: 'history', provider: 'fixture' };
  const reply: Provider['streamSimple'] = (_model, context, streamOptions) => {
    const stream = createAssistantMessageEventStream();
    const answer = context.messages.filter(m => m.role === 'user').map(m =>
      typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('')).join(' | ');
    const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: answer }],
      api: model.api, provider: 'fixture', model: 'history', stopReason: options.fail ? 'error' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } };
    options.started?.();
    void (async () => {
      if (options.pause) await Promise.race([options.pause, new Promise<void>(done => streamOptions?.signal?.addEventListener('abort', () => done(), { once: true }))]);
      if (streamOptions?.signal?.aborted) { message.stopReason = 'aborted'; stream.push({ type: 'error', reason: 'aborted', error: message }); }
      else if (options.fail) stream.push({ type: 'error', reason: 'error', error: { ...message, errorMessage: 'Fixture failure' } });
      else stream.push({ type: 'done', reason: 'stop', message });
    })();
    return stream;
  };
  models.setProvider({ id: 'fixture', name: 'Fixture', getModels: () => [model],
    auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } },
    stream: (m, c, o) => reply(m, c, { signal: o?.signal }), streamSimple: reply });
  return { models, model: { provider: 'fixture', modelId: 'history' } };
}
