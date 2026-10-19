// Cron-style agent fleet simulation: no VMs, no real model, no real services.
// Usage: node scripts/sim-agents.mjs [--stages 50,150,300] [--stage-s 90] [--period-s 60] [--real-period-min 15]
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import { Client } from 'eve/client';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const stages = arg('stages', '50,150,300').split(',').map(Number);
const stageMs = Number(arg('stage-s', 90)) * 1000;
const periodMs = Number(arg('period-s', 60)) * 1000;
const realPeriodMin = Number(arg('real-period-min', 15));
const MIN_AVAILABLE_KIB = 5 * 1024 ** 2;
const MAX_EVE_RSS_MIB = 1500;

// Safety: an accidental real-model call must fail, not spend.
const env = { ...process.env, MODEL_MODE: 'mock', OPENROUTER_API_KEY: '' };
await mkdir('results', { recursive: true });
const client = new Client({ host: 'http://127.0.0.1:4310' });
const logs = await Promise.all(['mock-model', 'eve-server'].map(name => open(`results/${name}.log`, 'w')));
const mock = spawn(process.execPath, ['scripts/mock-model.mjs'], { stdio: ['ignore', logs[0].fd, logs[0].fd], env });
const eve = spawn(process.execPath, ['node_modules/eve/bin/eve.js', 'start', '--host', '127.0.0.1', '--port', '4310'],
  { stdio: ['ignore', logs[1].fd, logs[1].fd], env });
const cgroup = (await readFile('/proc/self/cgroup', 'utf8')).trim().split('::').at(-1);
const mockStats = () => fetch('http://127.0.0.1:4311/stats').then(r => r.json());
const rssMiB = async pid => Number((await readFile(`/proc/${pid}/status`, 'utf8')).match(/VmRSS:\s+(\d+)/)[1]) / 1024;
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
const pick = list => list[Math.floor(Math.random() * list.length)];

const soul = n => `# Soul of agent ${n}\n${'I am a careful personal assistant. I keep answers short and verify before acting.\n'.repeat(35)}`;
const memory = n => `# Memory of agent ${n}\n${Array.from({ length: 80 }, (_, i) => `- fact ${i}: user prefers option ${i % 5} for topic ${i % 9}`).join('\n')}\n`;
const initPlan = n => [{ tool: 'bash', args: { command: `cat > SOUL.md <<'EOF'\n${soul(n)}EOF\ncat > MEMORY.md <<'EOF'\n${memory(n)}EOF\nmkdir -p reports` } }];
// ~85% light, ~12% medium, ~3% would need a real VM/native binary (counted, not run: just-bash has none).
function tickPlan(n, seq) {
  const roll = Math.random();
  if (roll > 0.97) return { kind: 'needs-vm', plan: null };
  const skill = `skill-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;
  const plan = [
    { tool: 'bash', args: { command: 'cat SOUL.md MEMORY.md' } },
    { tool: 'eve__skill', args: { name: skill } },
    { tool: 'call_integration', args: { service: pick(['calendar', 'email', 'crm']), path: '/events' } },
  ];
  if (roll > 0.85) {
    plan.push({ tool: 'call_integration', args: { service: 'email', path: '/inbox' } },
      { tool: 'call_integration', args: { service: 'crm', path: '/contacts' } },
      { tool: 'bash', args: { command: `cp templates/report.md reports/r${seq}.md && ls reports | wc -l` } });
  }
  plan.push({ tool: 'bash', args: { command: `echo "- tick ${seq}: processed ${skill}, no action needed" >> MEMORY.md` } });
  return { kind: roll > 0.85 ? 'medium' : 'light', plan };
}

const report = { kind: 'cron-agent-fleet-sim', startedAt: new Date().toISOString(), config: { stages, stageMs, periodMs, realPeriodMin }, stages: [] };
const agents = [];
let stopReason = null;
try {
  for (let i = 0; ; i++) {
    if (eve.exitCode !== null || i > 120) throw new Error('Eve not healthy; see results/eve-server.log');
    if (await client.health().then(() => true, () => false)) break;
    await delay(500);
  }
  const price = await fetch('https://openrouter.ai/api/v1/models').then(r => r.json())
    .then(j => j.data.find(m => m.id === 'anthropic/claude-haiku-5.5')?.pricing).catch(() => null);
  report.haikuPricingPerToken = price;

  for (const target of stages) {
    const stage = { agents: target, createMs: [], latencyMs: [], errors: 0, overruns: 0, ticks: { light: 0, medium: 0, 'needs-vm': 0 }, samples: [] };
    // 1) grow the fleet: create agents (each = one durable session with its own files)
    const createStart = performance.now();
    const pending = [];
    const grow = async () => {
      while (agents.length + pending.length < target && !stopReason) {
        const n = agents.length + pending.length;
        pending.push(n);
        const t = performance.now();
        const created = await client.sessions.create({ message: `Initialize agent ${n}. RAPHIE_PLAN ${JSON.stringify(initPlan(n))}` });
        await created.response.result();
        stage.createMs.push(Math.round(performance.now() - t));
        agents.push({ n, session: created.session, busy: false, seq: 0, phase: Math.random() * periodMs });
        pending.splice(pending.indexOf(n), 1);
      }
    };
    await Promise.all(Array.from({ length: 8 }, grow));
    stage.createWallMs = Math.round(performance.now() - createStart);
    const before = await mockStats();

    // 2) run cron ticks for the whole fleet in compressed time
    const stageStart = performance.now();
    const timers = agents.map(agent => {
      const fire = async () => {
        if (stopReason) return;
        if (agent.busy) { stage.overruns++; return; }
        const { kind, plan } = tickPlan(agent.n, ++agent.seq);
        stage.ticks[kind]++;
        if (!plan) return;
        agent.busy = true;
        const t = performance.now();
        try {
          const response = await agent.session.send(`Scheduled run ${agent.seq}. RAPHIE_PLAN ${JSON.stringify(plan)}`);
          const value = await response.result();
          if (value.status === 'failed') stage.errors++;
          stage.latencyMs.push(Math.round(performance.now() - t));
        } catch { stage.errors++; } finally { agent.busy = false; }
      };
      const start = setTimeout(() => { fire(); timers.push(setInterval(fire, periodMs)); }, agent.phase);
      return start;
    });
    const sampler = setInterval(async () => {
      try {
        const available = Number((await readFile('/proc/meminfo', 'utf8')).match(/MemAvailable:\s+(\d+)/)[1]);
        const eveRss = await rssMiB(eve.pid);
        const scope = Number(await readFile(`/sys/fs/cgroup${cgroup}/memory.current`, 'utf8')) / 1024 ** 2;
        stage.samples.push({ t: Math.round((performance.now() - stageStart) / 1000), availableMiB: Math.round(available / 1024), eveRssMiB: Math.round(eveRss), scopeMiB: Math.round(scope), load1: Number((await readFile('/proc/loadavg', 'utf8')).split(' ')[0]) });
        if (available < MIN_AVAILABLE_KIB) stopReason = 'host available memory < 5 GiB';
        else if (eveRss > MAX_EVE_RSS_MIB) stopReason = `Eve RSS > ${MAX_EVE_RSS_MIB} MiB`;
        else if (stage.errors > 20 && stage.errors > stage.latencyMs.length * 0.2) stopReason = 'error rate > 20%';
        if (eve.exitCode !== null) stopReason = 'Eve exited';
      } catch (error) { stopReason = `sampler: ${error}`; }
    }, 2000);
    await delay(stageMs);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    clearInterval(sampler);
    // let in-flight ticks finish (bounded)
    for (let i = 0; i < 60 && agents.some(a => a.busy); i++) await delay(500);
    const after = await mockStats();
    const ticksRun = stage.latencyMs.length + stage.errors;
    const disk = execSync("du -sk .eve/.workflow-data | cut -f1").toString().trim();
    const files = execSync("find .eve/.workflow-data -type f | wc -l").toString().trim();
    report.stages.push({
      agents: target, createWallMs: stage.createWallMs, createP50Ms: percentile(stage.createMs, 0.5),
      offeredTicksPerSec: Number((target / (periodMs / 1000)).toFixed(2)), completedTicks: stage.latencyMs.length, errors: stage.errors,
      overruns: stage.overruns, tickMix: stage.ticks,
      latencyMs: { p50: percentile(stage.latencyMs, 0.5), p95: percentile(stage.latencyMs, 0.95), p99: percentile(stage.latencyMs, 0.99), max: Math.max(0, ...stage.latencyMs) },
      peakEveRssMiB: Math.max(0, ...stage.samples.map(s => s.eveRssMiB)), peakScopeMiB: Math.max(0, ...stage.samples.map(s => s.scopeMiB)),
      minAvailableMiB: Math.min(...stage.samples.map(s => s.availableMiB)), peakLoad1: Math.max(0, ...stage.samples.map(s => s.load1)),
      workflowStateMiB: Math.round(Number(disk) / 1024), workflowStateFiles: Number(files),
      mock: { modelRequests: after.modelRequests - before.modelRequests, promptTokens: after.promptTokens - before.promptTokens,
        completionTokens: after.completionTokens - before.completionTokens,
        avgSystemTokensPerRequest: Math.round((after.systemChars - before.systemChars) / 4 / Math.max(1, after.modelRequests - before.modelRequests)),
        avgToolSchemaTokensPerRequest: Math.round((after.toolSchemaChars - before.toolSchemaChars) / 4 / Math.max(1, after.modelRequests - before.modelRequests)),
        avgConversationTokensPerRequest: Math.round((after.conversationChars - before.conversationChars) / 4 / Math.max(1, after.modelRequests - before.modelRequests)), integrationCalls: after.integrationCalls - before.integrationCalls },
      meanPromptTokensPerTick: ticksRun ? Math.round((after.promptTokens - before.promptTokens) / ticksRun) : null,
    });
    console.log(JSON.stringify(report.stages.at(-1)));
    if (stopReason) break;
  }
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.stopReason = stopReason;
  for (let i = 0; i < agents.length; i += 20) await Promise.all(agents.slice(i, i + 20).map(({ session }) =>
    session.reset({ reason: 'sim cleanup', signal: AbortSignal.timeout(10_000) }).catch(() => {})));
  for (const child of [eve, mock]) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(15_000).then(() => child.kill('SIGKILL'))]); }
  await Promise.all(logs.map(l => l.close()));
  report.finishedAt = new Date().toISOString();
  const file = `results/sim-${Date.now()}.json`;
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`report: ${file}`);
}
