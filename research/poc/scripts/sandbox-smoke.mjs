import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Sandbox, MiB } from 'microsandbox';

const name = `raphie-smoke-${Date.now()}`;
const report = { kind: 'real-microvm-smoke', name, startedAt: new Date().toISOString() };
let sandbox;
try {
  const start = performance.now();
  sandbox = await Sandbox.builder(name).image('docker.io/library/alpine:3.22')
    .cpus(1).memory(MiB(512)).create();
  report.createMs = Math.round(performance.now() - start);
  const output = await sandbox.execWith('/bin/sh', options => options
    .args(['-c', 'uname -sr; printf raphie-ok > /tmp/raphie-marker; cat /tmp/raphie-marker'])
    .timeout(30_000));
  assert.equal(output.code, 0);
  assert.match(output.stdout(), /raphie-ok/);
  report.output = output.stdout();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  if (sandbox) {
    await sandbox.stop();
    await Sandbox.remove(name);
    report.cleanedUp = true;
  }
  await mkdir('results', { recursive: true });
  await writeFile(`results/${name}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
