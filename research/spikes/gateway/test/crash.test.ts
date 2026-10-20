import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../src/gateway.ts';

test('SIGKILL after file write recovers without another result blob', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphie-crash-'));
  const child = spawn(process.execPath, [new URL('./crash-worker.ts', import.meta.url).pathname, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let app: Gateway | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('effect-written')) resolve(); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Crash worker exited before effect: ${code}`)));
    });
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const blobs = await readdir(join(directory, 'files'));
    assert.equal(blobs.length, 1);
    app = await Gateway.open({ directory });
    for (let n = 0; n < 150 && !(await app.state()).approvals[0].completedAt; n++) await delay(20);
    const approval = (await app.state()).approvals[0];
    assert.equal(approval.effectCount, 1);
    assert.equal((await app.files.read(approval.results[0].id)).toString(), 'Persist this exact note');
    assert.deepEqual(await readdir(join(directory, 'files')), blobs);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await app?.close(); await rm(directory, { recursive: true, force: true });
  }
});
