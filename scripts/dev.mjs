import { spawn } from 'node:child_process';
const children = ['dev:runtime', process.argv.includes('--production') ? 'start:web' : 'dev:web'].map(script => spawn('npm', ['run', script], { stdio: 'inherit', detached: true }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of children) child.once('exit', code => stop(code ?? 1));
