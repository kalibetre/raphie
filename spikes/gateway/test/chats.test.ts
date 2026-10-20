import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';
import { chatModel } from './chat-model.ts';

async function answered(app: Gateway, id: string) {
  for (let n = 0; n < 200; n++) {
    const turn = (await app.chats.state()).turns.find(t => t.id === id)!;
    if (turn.status !== 'pending') return turn;
    await delay(10);
  }
  assert.fail('Model reply did not settle');
}

test('conversation history and reply routing survive reopen, without leaking across threads or replaying events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-chat-'));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  const input = { source: 'discord' as const, eventId: '1', actor: 'owner', text: 'The proposal is due Thursday', discordThreadId: 'discord:guild:channel:one' };
  try {
    const first = await app.chats.send(input);
    assert.equal((await answered(app, first.id)).answer, input.text);
    await app.close(); app = await Gateway.open({ directory, ...config });
    assert.deepEqual(await app.chats.send(input), first);
    await assert.rejects(app.chats.send({ ...input, text: 'Different' }), /different content/);
    const next = await app.chats.send({ source: 'web', actor: 'owner', eventId: '2', text: 'When is it due?', conversationId: first.conversationId });
    assert.match((await answered(app, next.id)).answer!, /Thursday.*When is it due/);
    const isolated = await app.chats.send({ ...input, eventId: '3', text: 'Hello', discordThreadId: 'discord:guild:channel:two' });
    assert.equal((await answered(app, isolated.id)).answer, 'Hello');
    assert.equal((await app.chats.state()).conversations.length, 2);
    assert.equal((await app.chats.state()).deliveries.filter(d => d.threadId === input.discordThreadId).length, 2);
    const concurrent = await Promise.all(['First follow-up', 'Second follow-up'].map((text, index) => app.chats.send({
      source: 'web', actor: 'owner', eventId: `concurrent-${index}`, text, conversationId: first.conversationId,
    })));
    const replies = await Promise.all(concurrent.map(turn => answered(app, turn.id)));
    assert.equal(replies.every(turn => turn.status === 'done'), true);
    assert.match(replies[1].answer!, /First follow-up.*Second follow-up/);
    const claimed = await app.chats.claimDelivery(); assert.ok(claimed);
    await app.close(); app = await Gateway.open({ directory, ...config });
    assert.equal((await app.chats.state()).deliveries.find(d => d.id === claimed.id)!.status, 'uncertain');
    await assert.rejects(app.chats.send({ ...input, actor: 'stranger' }), /authorized/);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('provider failures settle visibly; missing model or invalid input never queues a turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-chat-errors-'));
  let app = await Gateway.open({ directory, ...chatModel({ fail: true }) });
  const input = { source: 'web' as const, actor: 'owner', eventId: 'failure', text: 'Hello' };
  try {
    await assert.rejects(app.chats.send({ ...input, text: '' }), /message/);
    const sent = await app.chats.send(input);
    const failed = await answered(app, sent.id);
    assert.equal(failed.status, 'error'); assert.equal(failed.answer, null);
    await app.close(); app = await Gateway.open({ directory });
    await assert.rejects(app.chats.send({ ...input, eventId: 'unconfigured' }), /OPENROUTER_API_KEY/);
    assert.equal((await app.chats.state()).turns.length, 1);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('unfinished model generation resumes on reopen and yields one persisted reply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-chat-resume-'));
  let started!: () => void;
  const active = new Promise<void>(done => { started = done; });
  let app = await Gateway.open({ directory, ...chatModel({ started, pause: new Promise(() => {}) }) });
  try {
    const sent = await app.chats.send({ source: 'web', actor: 'owner', eventId: 'resume', text: 'Remember this' });
    await active; await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    const turn = await answered(app, sent.id);
    assert.equal(turn.status, 'done'); assert.equal(turn.answer, 'Remember this');
    assert.equal((await app.chats.state()).turns.length, 1);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
