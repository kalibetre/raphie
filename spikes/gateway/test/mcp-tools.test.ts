import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';
import type { McpClient } from '../src/mcp.ts';
import { chatModel } from './chat-model.ts';

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await delay(10); }
  assert.fail('Expected MCP state did not settle.');
}
function fixture(call: McpClient['call']) {
  const client: McpClient = { server: { name: 'fixture', version: '1' },
    tools: [{ name: 'execute', description: 'Run a fixture operation', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }],
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
  try {
    const turn = await app.chats.send(input);
    await until(async () => (await app.toolApprovals.state()).approvals.length === 1);
    const proposal = (await app.toolApprovals.state()).approvals[0];
    assert.equal(calls.length, 0);
    assert.deepEqual(JSON.parse(proposal.argumentsJson), { code: 'perform_exactly_this()' });
    await app.close(); app = await Gateway.open({ directory, ...model(), mcp });
    await assert.rejects(app.toolApprovals.decide(proposal.id, 'approved', 'stranger', 'web'), /authorized/);
    await assert.rejects(app.toolApprovals.decide(proposal.id, 'approved', 'owner', 'discord', 'discord:guild:channel:wrong'), /another Discord thread/);
    const statuses = await Promise.all([
      app.toolApprovals.decide(proposal.id, 'approved', 'owner', 'web'),
      app.toolApprovals.decide(proposal.id, 'rejected', 'owner', 'discord', input.discordThreadId),
    ]);
    assert.deepEqual(statuses, ['approved', 'approved']);
    await until(async () => (await app.chats.state()).turns.find(t => t.id === turn.id)?.status === 'done');
    assert.deepEqual(calls, [['execute', { code: 'perform_exactly_this()' }]]);
    assert.match((await app.chats.state()).turns[0].answer!, /External result confirmed/);
    assert.equal((await app.toolApprovals.state()).approvals[0].execution, 'done');
    assert.equal((await app.toolApprovals.state()).deliveries.every(d => d.threadId === input.discordThreadId), true);
    await app.close(); app = await Gateway.open({ directory, ...model(), mcp });
    assert.equal(calls.length, 1);
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
