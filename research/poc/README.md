# PoC: Eve agents on microsandbox, with a zero-token fleet simulator

Throwaway code from the experiment in `../EXPERIMENT-REPORT.md`. It is a reference, not a base for the product. Nothing here has been run since the dev machine was cleaned up, and `node_modules` was not kept.

## Setup

Node 24+. `npm install --ignore-scripts`. `microsandbox` is pinned to 0.5.10 because Eve 0.80.1 requires `^0.5.0`. VM tests also need `/dev/kvm`, and `scripts/with-kvm.sh` needs passwordless `sudo` plus systemd.

Config is in `.env.schema` (Varlock). Default is `MODEL_MODE=mock`, which spends no tokens. For a real call, put `MODEL_MODE=openrouter` and `OPENROUTER_API_KEY` in a private `.env.local`. Eve loads that file by itself, so the zero-token tests blank the key explicitly.

Scripts write to `results/` relative to this folder (git-ignored). The runs from the experiment are archived in `../results/`.

## Layout

| Path | Purpose |
|------|---------|
| `agent/agent.ts` | Eve agent. OpenAI-compatible provider, mock by default, per-session cost cap 0.25 USD. |
| `agent/sandbox.ts` | Sandbox choice: Eve's `JustBashSandbox` (pure JS, no VM) with baked-in templates. |
| `agent/tools/call_integration.ts` | Calls mock calendar/email/CRM integrations on host side (credentials never enter a sandbox). |
| `agent/skills/skill-01..12.md` | Dummy skills to give the prompt a realistic size. |
| `agent/channels/eve.ts` | Loopback-only channel, no auth. Test use only. |
| `sim-stash/sandbox.microvm.ts` | The microVM sandbox variant (`node:24-bookworm-slim`, 1 vCPU, 512 MiB, network denied). Swap it in for `agent/sandbox.ts` for VM tests. |
| `sim-stash/mock-model.v1.mjs` | First version of the mock model, kept for comparison. |

## Scripts

| Script | What it does | Needs KVM |
|--------|--------------|-----------|
| `mock-model.mjs` | Fake OpenAI-compatible model plus fake integrations (50-300 ms latency, 2% 503s). Scripted via `RAPHIE_PLAN`; counts prompt tokens by body length / 4. | no |
| `sim-agents.mjs` | Cron fleet simulation in compressed time. `--stages 50,150,300 --stage-s 90 --period-s 60`. Mix: 85% light, 12% medium, 3% "needs VM" (counted, not run). Has host-memory guards. Known flaw: `peakEveRssMiB` reads the launcher PID. | no |
| `test-lifecycle.mjs` | Durable session lifecycle; `--capacity` registers 100 sessions and watches running VMs. | yes |
| `test-live.mjs` | One real OpenRouter turn with a tool call. Only script that spends tokens. | yes |
| `sandbox-smoke.mjs`, `probe-kernel.mjs`, `check-kvm.py`, `setup-runtime.mjs` | Smoke and environment probes. | yes |
| `test-docker-vm.mjs` | Docker (and Postgres/Testcontainers steps) inside a microVM: `--through alpine\|pg\|py\|tc`, `--allowlist`. | yes |
| `test-net-bulk.mjs` | Bulk download inside a microVM. Reproduces the guest hang. | yes |
| `with-kvm.sh` | Runs a command under a transient systemd scope (memory cap `SCOPE_MEM`, default 2G; refuses below 5 GiB free) with the `kvm` group. Use `with-kvm.sh env MODEL_MODE=mock OPENROUTER_API_KEY= ...` because `sudo` resets the environment. | yes |
| `host-monitor.sh` | 1 Hz fsynced host stats, for catching crashes. | no |
| `inspect-host.sh` | Prints CPU, RAM, KVM and permissions of the host. | no |

Examples (zero tokens):

    npm run mock                                  # fake model on :4311
    node scripts/sim-agents.mjs --stages 50,150   # fleet simulation

## Warnings

- Do not run `test-docker-vm.mjs` or `test-net-bulk.mjs` on a shared machine. The guest hangs on bulk downloads and one host reboot probably followed.
- `package.json` name and description still say "raphie-prototype / throwaway". Keep it that way so it is not mistaken for the real agent.
