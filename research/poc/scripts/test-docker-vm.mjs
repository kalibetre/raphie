// Can a leased microVM run Docker + a Testcontainers pytest? One VM, timed phases, always cleaned up.
// Usage: node scripts/test-docker-vm.mjs [--allowlist]   (default: all public egress)
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Sandbox, MiB, NetworkPolicy, NetworkPolicyBuilder } from 'microsandbox';

const allowlist = process.argv.includes('--allowlist');
const through = process.argv[process.argv.indexOf('--through') + 1] ?? 'pg'; // alpine | pg | py | tc
const name = `raphie-docker-${Date.now()}`;
const report = { kind: 'docker-in-microvm', allowlist, name, startedAt: new Date().toISOString(), steps: [] };
const domains = ['registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com', 'dl-cdn.alpinelinux.org',
  'pypi.org', 'files.pythonhosted.org'];
const test = `
import pg8000.native, time
from testcontainers.postgres import PostgresContainer

def test_postgres_roundtrip():
    with PostgresContainer("postgres:16-alpine") as pg:
        deadline = time.time() + 30
        while True:
            try:
                con = pg8000.native.Connection(user=pg.username, password=pg.password, host=pg.get_container_host_ip(),
                                               port=int(pg.get_exposed_port(5432)), database=pg.dbname)
                break
            except Exception:
                if time.time() > deadline: raise
                time.sleep(1)
        assert con.run("select 40 + 2")[0][0] == 42
`;
const steps = [
  ['dockerd start', `mkdir -p /var/lib/docker && mount -t tmpfs -o size=1024m tmpfs /var/lib/docker
nohup dockerd --storage-driver=overlay2 > /tmp/dockerd.log 2>&1 < /dev/null &
for i in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 1; done; docker info --format 'driver={{.Driver}} cgroup={{.CgroupVersion}} mem={{.MemTotal}}' || { tail -30 /tmp/dockerd.log; exit 1; }`, 90_000],
  ['docker run (pull + run)', `docker run --rm alpine:3.22 sh -c 'echo inner-container-ok'`, 180_000],
  ['postgres container (pull + ready)', { poll: true }, 0],
  ['install python + testcontainers', `apk add --no-cache python3 py3-pip >/dev/null && python3 -m venv /opt/v && /opt/v/bin/pip install -q pytest 'testcontainers[postgres]' pg8000 2>&1 | tail -3`, 300_000],
  ['pytest + testcontainers (postgres)', `mkdir -p /work && cat > /work/test_pg.py <<'PY'\n${test}\nPY\ncd /work && TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 /opt/v/bin/pytest -x -q test_pg.py 2>&1 | tail -25`, 300_000],
  ['guest memory after', `free -m | sed -n 2p; docker ps -a --format '{{.Names}} {{.Status}}' | head -5`, 30_000],
];
function policy() {
  if (!allowlist) return NetworkPolicy.publicOnly();
  return new NetworkPolicyBuilder().defaultDeny().egress(r => r.allowDomains(domains)).any(r => r.allowLoopback());
}
const order = ['dockerd start', 'docker run (pull + run)', 'postgres container (pull + ready)', 'install python + testcontainers', 'pytest + testcontainers (postgres)'];
const last = { alpine: 1, pg: 2, py: 3, tc: 4 }[through];
const selected = steps.filter(([label]) => order.indexOf(label) <= last);
// Abort guard: stop the VM early if the shared host gets tight.
let sandbox;
let aborted = null;
const guard = setInterval(async () => {
  const { readFile } = await import('node:fs/promises');
  const available = Number((await readFile('/proc/meminfo', 'utf8')).match(/MemAvailable:\s+(\d+)/)[1]) / 1024;
  const load = Number((await readFile('/proc/loadavg', 'utf8')).split(' ')[0]);
  if (available < 6000 || load > 6) { aborted = `host guard: avail=${Math.round(available)}MiB load=${load}`; await sandbox?.stop().catch(() => {}); }
}, 1000);
try {
  let t = performance.now();
  sandbox = await Sandbox.builder(name).image('docker.io/library/docker:dind').cpus(1).memory(MiB(2048))
    .network(n => n.policy(policy())).create();
  report.createMs = Math.round(performance.now() - t);
  for (const [label, script, timeout] of selected) {
    t = performance.now();
    let out;
    if (script.poll) {
      const sh = (cmd, ms = 20_000) => sandbox.execWith('/bin/sh', o => o.args(['-c', cmd]).timeout(ms));
      await sh('nohup sh -c "docker pull postgres:16-alpine > /tmp/pull.log 2>&1; echo PULL-EXIT=$? >> /tmp/pull.log" > /dev/null 2>&1 < /dev/null &');
      let tail = '';
      for (let i = 0; i < 24 && !aborted; i++) {
        await new Promise(r => setTimeout(r, 10_000));
        const probe = await sh(`echo "mem: $(free -m | sed -n 2p | tr -s ' ')"; echo "docker_disk=$(du -sm /var/lib/docker 2>/dev/null | cut -f1)MiB layers_done=$(grep -c 'Pull complete' /tmp/pull.log)"; tail -c 200 /tmp/pull.log | tr '\\r\\n' '  '; echo; dmesg 2>/dev/null | tail -2`, 20_000).catch(e => ({ code: -1, stdout: () => 'probe failed: ' + e, stderr: () => '' }));
        const text = probe.stdout();
        console.log(`  +${Math.round((performance.now() - t) / 1000)}s ${text.replace(/\n/g, ' | ')}`);
        tail = text;
        if (text.includes('PULL-EXIT=')) break;
      }
      if (!tail.includes('PULL-EXIT=0')) { out = { code: 3, stdout: () => tail, stderr: () => 'pull did not finish cleanly' }; }
      else out = await sh(`docker run -d --name pg -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null && for i in $(seq 1 40); do docker exec pg pg_isready -U postgres && break; sleep 1; done; docker exec pg psql -U postgres -tAc 'select 40+2'; docker rm -f pg >/dev/null`, 120_000);
    } else out = await sandbox.execWith('/bin/sh', o => o.args(['-c', script]).timeout(timeout));
    const step = { label, ms: Math.round(performance.now() - t), code: out.code, stdout: out.stdout().slice(-1500), stderr: out.stderr().slice(-800) };
    report.steps.push(step);
    console.log(`[${label}] exit=${step.code} ${step.ms}ms\n${step.stdout}${step.stderr ? '\nSTDERR: ' + step.stderr : ''}\n`);
    if (out.code !== 0) break;
  }
  report.passed = report.steps.length === selected.length && report.steps.every(s => s.code === 0);
} catch (error) {
  report.passed = false;
  report.error = String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  clearInterval(guard);
  report.aborted = aborted;
  if (sandbox) { await sandbox.stop().catch(() => {}); await Sandbox.remove(name).catch(() => {}); report.cleanedUp = true; }
  report.finishedAt = new Date().toISOString();
  await mkdir('results', { recursive: true });
  await writeFile(`results/${name}.json`, JSON.stringify(report, null, 2));
}
