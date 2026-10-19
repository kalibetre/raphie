// One real-model turn through Eve into a real microVM. Run via: varlock run -- node scripts/test-live.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'eve/client';

assert.equal(process.env.MODEL_MODE, 'openrouter', 'run through varlock with MODEL_MODE=openrouter');
await mkdir('results', { recursive: true });
const client = new Client({ host: 'http://127.0.0.1:4310' });
const log = await open('results/eve-live.log', 'a');
const eve = spawn(process.execPath, ['node_modules/eve/bin/eve.js', 'start', '--host', '127.0.0.1', '--port', '4310'],
  { stdio: ['ignore', log.fd, log.fd], env: process.env });
let session;
const report = { kind: 'eve-live-openrouter', model: process.env.OPENROUTER_MODEL, startedAt: new Date().toISOString() };
try {
  for (let i = 0; ; i++) {
    if (eve.exitCode !== null || i > 60) throw new Error('Eve not healthy; see results/eve-live.log');
    if (await client.health().then(() => true, () => false)) break;
    await delay(500);
  }
  const t = Date.now();
  const created = await client.sessions.create({ message:
    'In /workspace, write fib.js printing the first 10 Fibonacci numbers comma-separated, run it with node, then reply with only its output.' });
  session = created.session;
  const value = await created.response.result();
  report.elapsedMs = Date.now() - t;
  report.status = value.status;
  report.message = value.message;
  report.eventTypes = [...new Set(value.events.map(e => e.type))];
  report.bashCalls = JSON.stringify(value.events).match(/"bash"/g)?.length ?? 0;
  report.usageEvents = value.events.filter(e => JSON.stringify(e).includes('Tokens')).slice(-1);
  assert.notEqual(value.status, 'failed', JSON.stringify(value.events.filter(e => e.type?.includes('failed'))));
  assert.match(value.message ?? '', /0,\s*1,\s*1,\s*2,\s*3,\s*5,\s*8,\s*13,\s*21,\s*34/);
  assert.ok(report.bashCalls > 0, 'model never called the sandbox bash tool');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await session?.reset({ reason: 'live test cleanup', signal: AbortSignal.timeout(15_000) }).catch(() => {});
  eve.kill('SIGTERM');
  await Promise.race([once(eve, 'exit'), delay(15_000).then(() => eve.kill('SIGKILL'))]);
  await log.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`results/live-${Date.now()}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
