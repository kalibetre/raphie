import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';
import { createDiscordBridge, resolveDiscordThread } from '../src/discord.ts';

test('server channel without a configured guild resolves to the incoming event route', async () => {
  const lookup = (async () => Response.json({ id: 'channel', type: 0, guild_id: 'guild' })) as typeof fetch;
  assert.equal(await resolveDiscordThread({ botToken: 'fixture', channelId: 'channel' }, lookup), 'discord:guild:channel');
  await assert.rejects(resolveDiscordThread({ botToken: 'fixture', channelId: 'channel', guildId: 'wrong' }, lookup), /does not match/);
  const dm = (async () => Response.json({ id: 'channel', type: 1 })) as typeof fetch;
  assert.equal(await resolveDiscordThread({ botToken: 'fixture', channelId: 'channel' }, dm), 'discord:@me:channel');
  const denied = (async () => new Response('', { status: 403 })) as typeof fetch;
  await assert.rejects(resolveDiscordThread({ botToken: 'fixture', channelId: 'channel' }, denied), /403/);
});

test('real Chat SDK parses incoming files, renders buttons, handles actions and uploads results', async () => {
  const requests: { method: string; path: string; body: Buffer }[] = [];
  const api = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method!, path: req.url!, body: Buffer.concat(chunks) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'outgoing-1', channel_id: 'channel', content: '', author: { id: 'bot', username: 'raphie', bot: true }, timestamp: new Date().toISOString(), attachments: [] }));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const address = api.address(); assert.ok(address && typeof address === 'object');
  // SDK 4.43.0 ignores apiUrl for multipart uploads. Intercept fetch as well,
  // routing those calls to the fixture and rejecting every other network host.
  const originalFetch = globalThis.fetch;
  const apiUrl = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin === 'https://discord.com') return originalFetch(`${apiUrl}${url.pathname.replace(/^\/api\/v10/, '')}`, init);
    assert.equal(url.origin, apiUrl, 'Tests must not contact external services');
    return originalFetch(input, init);
  };
  const directory = await mkdtemp(join(tmpdir(), 'raphie-discord-'));
  const threadId = 'discord:@me:channel';
  let app = await Gateway.open({ directory, discordThreadId: threadId });
  const bytes = new Uint8Array([0, 128, 255, 10]);
  const config = {
    botToken: 'fixture-token', applicationId: 'fixture-app', ownerId: 'owner-id', threadId,
    publicKey: '0'.repeat(64),
    apiUrl: `http://127.0.0.1:${address.port}`,
    attachmentFetch: (async () => new Response(bytes)) as typeof fetch,
  };
  let bridge = createDiscordBridge(app, config);
  try {
    await bridge.chat.initialize();
    const incoming = (author = 'owner-id', id = 'incoming-1') => bridge.adapter.parseMessage({
      id, channel_id: 'channel', content: 'Remember my manager notes',
      author: { id: author, username: author, bot: false }, timestamp: new Date().toISOString(),
      attachments: [{ filename: 'notes.bin', size: bytes.length, url: 'https://cdn.discordapp.com/attachments/test/notes.bin' }],
    });
    await bridge.chat.processMessage(bridge.adapter, threadId, incoming('stranger', 'unauthorized'));
    assert.equal((await app.state()).approvals.length, 0);
    await bridge.chat.processMessage(bridge.adapter, threadId, incoming());
    const approval = (await app.state()).approvals[0];
    assert.ok(approval);
    assert.deepEqual(new Uint8Array(await app.files.read(approval.files[0].id)), bytes);
    await bridge.flush();
    const payload = JSON.parse(requests[0].body.toString());
    assert.equal(payload.components[0].components[0].label, 'Approve');
    assert.ok(payload.components[0].components[0].custom_id.includes(approval.id));
    await bridge.chat.shutdown(); await app.close();
    app = await Gateway.open({ directory, discordThreadId: threadId });
    bridge = createDiscordBridge(app, config); await bridge.chat.initialize();
    // Event redelivery after the SDK's in-memory dedupe is lost still reuses durable state.
    await bridge.chat.processMessage(bridge.adapter, threadId, incoming());
    assert.equal((await app.state()).approvals.length, 1);
    const action = (userId: string) => bridge.chat.processAction({
      adapter: bridge.adapter, actionId: 'raphie-approve', value: approval.id,
      messageId: 'outgoing-1', threadId, raw: {},
      user: { userId, userName: userId, fullName: userId, isBot: false, isMe: false },
    }, undefined);
    await action('stranger');
    assert.equal((await app.state()).approvals[0].status, 'pending');
    await action('owner-id');
    for (let n = 0; n < 150 && !(await app.state()).approvals[0].completedAt; n++) await delay(20);
    await bridge.flush();
    assert.equal((await app.state()).approvals[0].effectCount, 1);
    const edit = requests.find(r => r.method === 'PATCH')!;
    assert.equal(JSON.parse(edit.body.toString()).components[0].components[0].disabled, true);
    const upload = requests.find(r => r.body.includes(Buffer.from('approved-notes.bin')))!;
    assert.ok(upload, 'SDK must upload the approved file as multipart data');
    assert.ok(upload.body.includes(Buffer.from(bytes)));
    assert.equal((await app.state()).deliveries.every(d => d.status === 'sent'), true);
    // A failed/unknown network operation becomes visible instead of being retried.
    const id = await app.accept({ source: 'web', eventId: 'failure', actor: 'owner', text: 'Test uncertain delivery', files: [] });
    bridge.adapter.postMessage = async () => { throw new Error('Connection lost after send'); };
    await bridge.flush(); await bridge.flush();
    assert.equal((await app.state()).deliveries.find(d => d.approvalId === id)?.status, 'uncertain');
  } finally {
    globalThis.fetch = originalFetch;
    await bridge.chat.shutdown(); await app.close();
    await new Promise<void>(resolve => { api.close(() => resolve()); api.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
});
