// Does bulk download inside a microVM hang the guest? No Docker. Alpine VM, public egress, wget to /dev/null.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Sandbox, MiB, NetworkPolicy } from 'microsandbox';

const url = process.argv[2] ?? 'http://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/alpine-standard-3.22.0-x86_64.iso';
const name = `raphie-net-${Date.now()}`;
const report = { kind: 'net-bulk', url, name, polls: [] };
let sandbox;
let aborted = null;
const guard = setInterval(async () => {
  const available = Number((await readFile('/proc/meminfo', 'utf8')).match(/MemAvailable:\s+(\d+)/)[1]) / 1024;
  const load = Number((await readFile('/proc/loadavg', 'utf8')).split(' ')[0]);
  if (available < 6000 || load > 6) { aborted = `host guard: avail=${Math.round(available)}MiB load=${load}`; await sandbox?.stop().catch(() => {}); }
}, 1000);
const sh = (cmd, ms = 15_000) => sandbox.execWith('/bin/sh', o => o.args(['-c', cmd]).timeout(ms));
try {
  sandbox = await Sandbox.builder(name).image('docker.io/library/alpine:3.22').cpus(1).memory(MiB(1024))
    .network(n => n.policy(NetworkPolicy.publicOnly())).create();
  await sh('nohup sh -c "timeout 60 wget -q -O /dev/null ' + url + '; echo WGET-EXIT=$? > /tmp/wget.done" > /dev/null 2>&1 < /dev/null &');
  const t = performance.now();
  let failures = 0;
  for (let i = 0; i < 16 && !aborted; i++) {
    await new Promise(r => setTimeout(r, 5_000));
    const sec = Math.round((performance.now() - t) / 1000);
    try {
      const out = await sh(`awk '/eth0/{print int($2/1048576)"MiB rx"}' /proc/net/dev; free -m | sed -n 2p | tr -s ' '; cat /tmp/wget.done 2>/dev/null`);
      const text = out.stdout().replace(/\n/g, ' | ');
      console.log(`+${sec}s ${text}`);
      report.polls.push({ sec, text });
      if (text.includes('WGET-EXIT')) break;
    } catch (error) {
      failures++;
      console.log(`+${sec}s probe failed: ${error}`);
      report.polls.push({ sec, error: String(error) });
      if (failures >= 3) break;
    }
  }
  report.result = failures >= 3 ? 'guest unresponsive during bulk download' : 'completed or ran full window';
} catch (error) {
  report.error = String(error);
  console.error(report.error);
} finally {
  clearInterval(guard);
  report.aborted = aborted;
  if (sandbox) { await sandbox.stop().catch(() => {}); await Sandbox.remove(name).catch(() => {}); }
  await mkdir('results', { recursive: true });
  await writeFile(`results/${name}.json`, JSON.stringify(report, null, 2));
  console.log(report.result ?? '', report.aborted ?? '');
}
