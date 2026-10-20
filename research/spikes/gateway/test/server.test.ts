import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';
import { startServer } from '../src/server.ts';
import { chatModel } from './chat-model.ts';

test('HTTP upload, restart, duplicate decisions and binary download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-http-'));
  let app = await Gateway.open({ directory, ...chatModel() });
  let http = await startServer(app, { port: 0 });
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const headers = { 'x-raphie-client': 'web' };
  try {
    assert.equal((await fetch(http.url)).status, 200);
    const message = { text: 'Remember Thursday', eventId: 'chat-event' };
    const chatResponse = await fetch(`${http.url}/api/chat`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(message) });
    assert.equal(chatResponse.status, 201);
    const sent = await chatResponse.json();
    const upload = () => {
      const form = new FormData();
      form.set('text', 'Keep these notes'); form.set('eventId', 'stable-event');
      form.append('files', new Blob([bytes]), '../../notes.bin');
      return fetch(`${http.url}/api/messages`, { method: 'POST', headers, body: form });
    };
    const response = await upload();
    assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.equal((await (await upload()).json()).id, id);
    assert.equal((await fetch(`${http.url}/api/approvals/${id}`, { method: 'POST', body: '{}' })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      get(`${http.url}/api/state`, { headers: { Host: 'evil.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(badHost, 403);
    await http.close(); await app.close();
    app = await Gateway.open({ directory, ...chatModel() }); http = await startServer(app, { port: 0 });
    const replay = await fetch(`${http.url}/api/chat`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(message) });
    assert.deepEqual(await replay.json(), sent);
    const chats = await (await fetch(`${http.url}/api/chats`)).json();
    assert.equal(chats.conversations[0].id, sent.conversationId);
    assert.equal(chats.turns.length, 1);
    const decide = () => fetch(`${http.url}/api/approvals/${id}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approved' }),
    });
    assert.deepEqual(await Promise.all([decide(), decide()]).then(rs => Promise.all(rs.map(r => r.json()))), [{ status: 'approved' }, { status: 'approved' }]);
    for (let n = 0; n < 150 && !(await app.state()).approvals[0].completedAt; n++) await delay(20);
    const approval = (await app.state()).approvals[0];
    assert.equal(approval.effectCount, 1);
    const downloaded = await fetch(`${http.url}/api/files/${approval.results[0].id}`);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
    assert.match(downloaded.headers.get('content-disposition')!, /approved-notes.bin/);
    assert.equal((await fetch(`${http.url}/api/files/${'0'.repeat(64)}`)).status, 404);
  } finally { await http.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
