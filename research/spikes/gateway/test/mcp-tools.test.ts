import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';
import type { McpClient } from '../src/mcp.ts';
import { chatModel } from './chat-model.ts';
import { startServer } from '../src/server.ts';
import { createDiscordBridge } from '../src/discord.ts';
import type { AdapterPostableMessage } from 'chat';

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await delay(10); }
  assert.fail('Expected MCP state did not settle.');
}
function fixture(call: McpClient['call']) {
  const client: McpClient = { server: { name: 'fixture', version: '1' },
    tools: [{ name: 'execute', description: 'Run a fixture operation', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }],
    call, close: async () => {} };
  return { client, identity: 'fixture-account' };
}
const model = () => chatModel({ tool: { name: 'mcp_fixture_execute', args: { code: 'perform_exactly_this()' } } });
const input = { source: 'discord' as const, actor: 'owner', eventId: 'tool', text: 'Use the tool', discordThreadId: 'discord:guild:channel:thread' };

test('model tool proposal survives reopen; owner decision executes exact arguments once and returns result to model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-mcp-gate-'));
  const calls: unknown[] = [];
  const mcp = fixture(async (name, args) => { calls.push([name, args]); return { content: [{ type: 'text', text: 'External result confirmed' }] }; });
  let app = await Gateway.open({ directory, ...model(), mcp });
  let http: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const turn = await app.chats.send(input);
    await until(async () => (await app.toolApprovals.state()).approvals.length === 1);
    const proposal = (await app.toolApprovals.state()).approvals[0];
    assert.equal(calls.length, 0);
    assert.deepEqual(JSON.parse(proposal.argumentsJson), { code: 'perform_exactly_this()' });
    await app.close(); app = await Gateway.open({ directory, ...model(), mcp });
    http = await startServer(app, { port: 0 });
    const visible = await (await fetch(`${http.url}/api/chats`)).json();
    assert.equal(visible.mcp.connected, true);
    assert.equal(visible.toolApprovals[0].argumentsJson, proposal.argumentsJson);
    assert.equal('fingerprint' in visible.toolApprovals[0], false);
    assert.equal('result' in visible.toolApprovals[0], false);
    const attachment = await (await fetch(`${http.url}/api/tool-approvals/${proposal.id}.json`)).json();
    assert.deepEqual(attachment.arguments, { code: 'perform_exactly_this()' });
    assert.equal((await fetch(`${http.url}/api/tool-approvals/${proposal.id}`, { method: 'POST', body: '{}' })).status, 403);
    await assert.rejects(app.toolApprovals.decide(proposal.id, 'approved', 'stranger', 'web'), /authorized/);
    await assert.rejects(app.toolApprovals.decide(proposal.id, 'approved', 'owner', 'discord', 'discord:guild:channel:wrong'), /another Discord thread/);
    const statuses = await Promise.all([
      app.toolApprovals.decide(proposal.id, 'approved', 'owner', 'web'),
      app.toolApprovals.decide(proposal.id, 'rejected', 'owner', 'discord', input.discordThreadId),
    ]);
    assert.deepEqual(statuses, ['approved', 'approved']);
    const duplicate = await fetch(`${http.url}/api/tool-approvals/${proposal.id}`, { method: 'POST',
      headers: { 'x-raphie-client': 'web', 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approved' }) });
    assert.deepEqual(await duplicate.json(), { status: 'approved' });
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    assert.deepEqual(calls, [['execute', { code: 'perform_exactly_this()' }]]);
    assert.match((await app.chats.state()).turns[0].answer!, /External result confirmed/);
    assert.equal((await app.toolApprovals.state()).approvals[0].execution, 'done');
    assert.equal((await app.toolApprovals.state()).deliveries.every(d => d.threadId === input.discordThreadId), true);
    await http.close(); http = undefined;
    await app.close(); app = await Gateway.open({ directory, ...model(), mcp });
    assert.equal(calls.length, 1);
  } finally { await http?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Discord tool approvals attach full arguments, enforce owner/thread, and disable resolved buttons', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-mcp-discord-'));
  let calls = 0;
  const code = `return ${JSON.stringify('x'.repeat(2500))};`;
  const app = await Gateway.open({ directory,
    ...chatModel({ tool: { name: 'mcp_fixture_execute', args: { code } } }),
    mcp: fixture(async () => { calls++; return { content: [{ type: 'text', text: 'Approved result' }] }; }) });
  const bridge = createDiscordBridge(app, { ownerId: 'owner-id', threadId: 'discord:guild:channel',
    applicationId: 'fixture', botToken: 'fixture-token', publicKey: '0'.repeat(64) });
  const sent: { threadId: string; message: AdapterPostableMessage }[] = [];
  const edits: AdapterPostableMessage[] = [];
  bridge.adapter.postMessage = async (threadId, message) => {
    sent.push({ threadId, message }); return { id: `sent-${sent.length}`, threadId, raw: {} };
  };
  bridge.adapter.editMessage = async (threadId, id, message) => { edits.push(message); return { id, threadId, raw: {} }; };
  try {
    await bridge.chat.initialize();
    const turn = await app.chats.send(input);
    await until(async () => (await app.toolApprovals.state()).approvals.length === 1);
    const approval = (await app.toolApprovals.state()).approvals[0];
    await bridge.flush();
    const card = sent[0].message;
    assert.ok(typeof card === 'object' && 'files' in card);
    const data = card.files![0].data; assert.ok(Buffer.isBuffer(data));
    assert.equal(JSON.parse(data.toString()).arguments.code, code);
    const action = (userId: string, threadId = input.discordThreadId) => bridge.chat.processAction({
      adapter: bridge.adapter, actionId: 'raphie-tool-approve', value: approval.id, messageId: 'sent-1', threadId, raw: {},
      user: { userId, userName: userId, fullName: userId, isBot: false, isMe: false },
    }, undefined);
    await action('stranger'); await assert.rejects(action('owner-id', 'discord:guild:channel:other'), /another Discord thread/);
    assert.equal((await app.toolApprovals.state()).approvals[0].status, 'pending');
    assert.equal(calls, 0);
    await action('owner-id');
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    await bridge.flush();
    assert.equal(calls, 1); assert.equal(edits.length, 1);
    const edit = edits[0]; assert.ok(typeof edit === 'object' && 'children' in edit);
    const actions = edit.children.find(c => c.type === 'actions'); assert.ok(actions?.type === 'actions');
    assert.equal(actions.children.every(c => c.type === 'button' && c.disabled), true);
    assert.equal(sent.every(m => m.threadId === input.discordThreadId), true);
    await action('owner-id'); assert.equal(calls, 1);
  } finally { await bridge.chat.shutdown(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('explicit documentation allowlist runs directly; arbitrary read-only hints do not bypass approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-mcp-docs-'));
  let calls = 0;
  const mcp = fixture(async () => { calls++; return { content: [{ type: 'text', text: 'Documentation' }] }; });
  mcp.client.tools[0].name = 'docs';
  const app = await Gateway.open({ directory, ...chatModel({ tool: { name: 'mcp_fixture_docs', args: { code: 'guide' } } }),
    mcp: { ...mcp, documentationTools: ['docs'] } });
  try {
    const turn = await app.chats.send(input);
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    assert.equal(calls, 1); assert.equal((await app.toolApprovals.state()).approvals.length, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const decision of ['rejected', 'expired'] as const) test(`MCP ${decision} proposal never calls the remote tool`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-mcp-deny-'));
  let calls = 0;
  const app = await Gateway.open({ directory, ...model(), approvalTtlMs: decision === 'expired' ? 60 : 600_000,
    mcp: fixture(async () => { calls++; return { content: [] }; }) });
  try {
    const turn = await app.chats.send(input);
    await until(async () => (await app.toolApprovals.state()).approvals.length === 1);
    const proposal = (await app.toolApprovals.state()).approvals[0];
    if (decision === 'rejected') await app.toolApprovals.decide(proposal.id, 'rejected', 'owner', 'web');
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    assert.equal((await app.toolApprovals.state()).approvals[0].status, decision);
    assert.equal(calls, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('restart after remote execution claim reports uncertainty without repeating the action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-mcp-uncertain-'));
  let calls = 0;
  const mcp = fixture(async (_name, _args, signal) => {
    calls++;
    await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('Lost reply')), { once: true }));
    return { content: [] };
  });
  let app = await Gateway.open({ directory, ...model(), mcp });
  try {
    const turn = await app.chats.send(input);
    await until(async () => (await app.toolApprovals.state()).approvals.length === 1);
    const proposal = (await app.toolApprovals.state()).approvals[0];
    await app.toolApprovals.decide(proposal.id, 'approved', 'owner', 'web');
    await until(async () => calls === 1);
    await app.close(); app = await Gateway.open({ directory, ...model(), mcp });
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    assert.equal(calls, 1);
    assert.equal((await app.toolApprovals.state()).approvals[0].execution, 'uncertain');
    assert.match((await app.chats.state()).turns[0].answer!, /outcome is unknown/);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
