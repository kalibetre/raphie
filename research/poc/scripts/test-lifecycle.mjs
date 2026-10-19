import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'eve/client';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { Sandbox } from 'microsandbox';

await mkdir('results', { recursive: true });
const report = { kind: 'eve-real-vm-lifecycle-with-mock-model', startedAt: new Date().toISOString(), checks: [] };
const client = new Client({ host: 'http://127.0.0.1:4310' });
const children = [];
const sessions = [];
const logHandles = [];
const capacity = process.argv.includes('--capacity');
const samples = [];
const cgroup = (await readFile('/proc/self/cgroup', 'utf8')).trim().split('::').at(-1);
async function sample() {
  const memory = await readFile('/proc/meminfo', 'utf8');
  const availableKiB = Number(memory.match(/MemAvailable:\s+(\d+)/)[1]);
  const scopeBytes = Number(await readFile(`/sys/fs/cgroup${cgroup}/memory.current`, 'utf8'));
  const runningVMs = (await Sandbox.list()).filter(vm => vm.status === 'running').length;
  samples.push({ at: Date.now(), availableMiB: Math.round(availableKiB / 1024), scopeMiB: Math.round(scopeBytes / 1024 ** 2), runningVMs });
  if (availableKiB < 5 * 1024 ** 2) throw new Error('Stopped: host available memory fell below 5 GiB');
}
let eve;
async function start(name, args) {
  const log = await open(`results/${name}.log`, 'a');
  logHandles.push(log);
  const child = spawn(process.execPath, args, { stdio: ['ignore', log.fd, log.fd], env: { ...process.env, MODEL_MODE: 'mock' } });
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try { await exited; } finally { clearTimeout(timeout); }
}
async function startEve() {
  eve = await start('eve-server', ['node_modules/eve/bin/eve.js', 'start', '--host', '127.0.0.1', '--port', '4310']);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (eve.exitCode !== null) throw new Error('Eve exited; inspect results/eve-server.log');
    if (await client.health().then(() => true, () => false)) return;
    await delay(500);
  }
  throw new Error('Eve did not become healthy');
}
const command = text => `RAPHIE_COMMAND ${JSON.stringify({ command: text })}`;
async function result(response, marker) {
  const value = await response.result();
  await writeFile(`results/turn-${value.sessionId}-${Date.now()}.json`, JSON.stringify(value, null, 2));
  assert.notEqual(value.status, 'failed', JSON.stringify(value.events.filter(event => event.type?.includes('failed'))));
  assert.match(value.message ?? '', new RegExp(marker));
  return value;
}
try {
  await start('mock-model', ['scripts/mock-model.mjs']);
  await startEve();
  const created = await client.sessions.create({ message: command("printf 'raphie-persisted' > /workspace/raphie-marker; cat /workspace/raphie-marker") });
  sessions.push(created.session);
  await result(created.response, 'raphie-persisted');
  report.checks.push('real sandbox command execution');
  await stop(eve);
  await startEve();
  await result(await created.session.send(command('cat /workspace/raphie-marker')), 'raphie-persisted');
  report.checks.push('same session and guest file survive Eve process restart');
  const other = await client.sessions.create({ message: command('test ! -e /workspace/raphie-marker && printf isolated') });
  sessions.push(other.session);
  await result(other.response, 'isolated');
  report.checks.push('second session has an independent writable filesystem');
  if (capacity) {
    await sample();
    const baseline = (await Sandbox.list()).filter(vm => vm.status === 'running').length;
    const started = performance.now();
    while (sessions.length < 100) {
      const idle = await client.sessions.create();
      sessions.push(idle.session);
      if (sessions.length % 10 === 0) await sample();
    }
    const runningAfter = (await Sandbox.list()).filter(vm => vm.status === 'running').length;
    assert.equal(runningAfter, baseline, 'Registering idle sessions unexpectedly started VMs');
    report.idleRegistration = { sessions: sessions.length, elapsedMs: Math.round(performance.now() - started),
      additionalRunningVMs: runningAfter - baseline };
    report.concurrentRuns = [];
    for (const concurrency of [1, 2]) {
      await sample();
      const sampleStart = samples.length;
      const started = performance.now();
      const turns = sessions.slice(0, concurrency).map(async (session, index) => {
        const begin = performance.now();
        const response = await session.send(command(`node -e 'setTimeout(()=>{let n=0; for(let i=0;i<2000000;i++) n+=i; console.log("worker-${index}",n)},2000)'`));
        await result(response, `worker-${index}`);
        return Math.round(performance.now() - begin);
      });
      const monitor = setInterval(() => sample().catch(error => {
        report.resourceStop = String(error);
        for (const session of sessions.slice(0, concurrency)) session.cancel().catch(() => {});
      }), 500);
      let turnMs;
      try { turnMs = await Promise.all(turns); } finally { clearInterval(monitor); }
      if (report.resourceStop) throw new Error(report.resourceStop);
      const peakRunningVMs = Math.max(0, ...samples.slice(sampleStart).map(sample => sample.runningVMs));
      assert.ok(peakRunningVMs >= concurrency, 'Sampler did not observe the requested active VM overlap');
      report.concurrentRuns.push({ concurrency, elapsedMs: Math.round(performance.now() - started), turnMs, peakRunningVMs });
    }
    report.checks.push('100 durable session registrations did not allocate extra running VMs');
    report.checks.push('1 and 2 concurrent real sandbox turns passed');
    report.resourceSamples = samples;
    report.scopePeakMiB = Math.round(Number(await readFile(`/sys/fs/cgroup${cgroup}/memory.peak`, 'utf8')) / 1024 ** 2);
    report.limit = 'Shared development VM: maximum active test concurrency is 2; no maximum-capacity claim.';
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  for (const session of sessions) await session.reset({ reason: 'Prototype test cleanup', signal: AbortSignal.timeout(15_000) }).catch(error => {
    report.cleanupError = String(error);
  });
  for (const child of children.reverse()) await stop(child);
  for (const log of logHandles) await log.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`results/lifecycle-${Date.now()}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
