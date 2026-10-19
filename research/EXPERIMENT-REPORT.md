# Raphie experiment report: running many agents cheaply

Date: 2026-10-17. Status: experiment finished, dev machine cleaned up. Blow-by-blow log: `VM-ACTIVITY-LOG.md`. Raw results: `results/`. Runnable code: `poc/`.

## Why we did this

The motivating platform runs one Kubernetes pod per agent, reserving 320Mi/50m and up to 1Gi/500m each. Namespace quotas were nearly full, so capacity was the product's limit. Goal: find a way to run 100+ agents, with a cheap tier and a premium tier.

## What we built and tested

All of it ran on the shared dev host (a 20 GB RAM VM with nested KVM), inside `~/raphie-prototype`, under a 2 GiB (later 3-4 GiB) memory scope and a "stop if less than 5 GiB available" guard. Sources are in `poc/` (`agent/`, `scripts/`, `sim-stash/`); see `poc/README.md`.

| # | Test | Result |
|---|------|--------|
| 1 | Real microVM (microsandbox 0.5.10, libkrun) boots on dev | Works. First boot 4.4 s including image setup. |
| 2 | Eve 0.80.1 agent with a microVM sandbox per session; file persists across Eve restart; second session isolated | Pass. |
| 3 | 100 durable sessions registered | 0 extra running VMs. Two concurrent real VM turns observed. No higher concurrency tried. |
| 4 | Live call: Eve -> OpenRouter (`anthropic/claude-haiku-5.5`) -> tool call in a microVM | Pass, 3.5 s, about 4.2k input / 169 output tokens. Only real spend of the whole experiment (cents). |
| 5 | **Cron-style fleet simulation**: 50 / 150 / 300 agents, no VMs (Eve `just-bash` sandbox), mock model, mock integrations | 0 errors; tick latency p50 ~300 ms, p95 ~750 ms; process memory 0.5 / 0.67 / 1.03 GiB; about 2 MiB per extra agent. Ceiling not found. |
| 6 | Docker inside a microVM | dockerd starts in 0.6 s (needs tmpfs storage); an inner Alpine container runs in 4.8 s. |
| 7 | Bulk download inside a microVM (Postgres image pull; plain `wget`) | **Guest becomes unresponsive after ~40-50 MiB.** Reproduced without Docker. |
| 8 | Testcontainers + Postgres | Not completed (blocked by 7). |

## Findings

1. **Idle sessions are free; active agents are cheap if they don't need a VM.** Registering 100 sessions started no VMs. A simulated cron fleet needed about 2 MiB per agent (mock model, small files, no chat connections, so an upper bound on the gain).
2. **Token cost is the real cost.** About 47k to 62k input tokens per tick (5 model calls), still growing because long-lived sessions re-send history. Catalog price for haiku-5.5 is $0.10/M input, $0.50/M output, $0.01/M cache read, so about $0.5 per agent per day at 96 ticks/day without prompt caching. A fresh session per tick (state in files) and caching should cut this; untested.
3. **Eve's local workflow store grows fast**: about 100 files per tick, 434 MiB / 97,654 files after 7 minutes at 300 agents. Needs retention or a Postgres-backed store before production.
4. **What actually needs a real VM or container**: native binaries (`git`, `npm`, `pytest`, compilers, `ffmpeg`), untrusted code, heavy CPU, and network isolation. `just-bash` covers files, `jq`/`sqlite3`/CSV tools, optional Python and JS, and `curl` if enabled. Integrations (CRM, email, speech-to-text APIs) belong in host-side tools, which also keeps credentials out of sandboxes.
5. **Microsandbox is not trustworthy for bulk network traffic here.** Guest hangs on larger downloads. One host reboot at ~12:51Z happened during a pip install inside a VM; the link is likely but unproven (no logs survived).
6. **Eve loads `.env.local` by itself**; `sudo` in `with-kvm.sh` resets the environment. Tests that must not spend tokens blank `OPENROUTER_API_KEY` and force `MODEL_MODE=mock`.
7. Overlay2 Docker storage cannot sit on the microVM's overlay root; use a tmpfs or a dedicated disk.

## Design direction (decided in conversation)

- Two tiers: **premium** full-featured agents (dedicated pod, higher price) and **cheap** Eve-style agents, many per shared pod, hosted per organization to keep tenants separate.
- Light agents (reminders, digests, Jira/CRM helpers, sales-file processing via host tools) go to the cheap tier.
- Heavy tasks (code reviewer cloning a repo and running tests, possibly with Docker/Testcontainers) use a per-task sandbox pod with a `RuntimeClass`, not a per-agent VM. Options: Kata (needs KVM nodes, probably bare-metal servers), Sysbox (Docker-in-pod, no KVM, weaker isolation, needs a supported node OS), gVisor (no KVM, limited Docker). Which one depends on whether the reviewed code is only your own. The Kubernetes SIG [Agent Sandbox](https://agent-sandbox.sigs.k8s.io/docs/getting_started/overview/) project is relevant but early.
- Cloud VPS instances often have no nested virtualization (e.g. Hetzner Cloud, per community reports, unverified); check `ls /dev/kvm` on a current worker.

## Platform notes (generic)

- One Deployment per agent; requests 320Mi/50m, limits 1Gi/500m.
- Namespace quota counts both requests and limits; requests are the binding axis.
- A tenant-level deployer account usually cannot read quotas or create RBAC, so cluster-level pieces (`RuntimeClass`) need the cluster owners.
- Per-agent CPU/memory already flows to Prometheus. Use it to right-size.
- A new runtime fits beside the existing per-agent builders, behind a runtime-neutral communications protocol.

## Suggested next steps

1. Pull per-agent working-set numbers from Prometheus; right-size requests; grow the quota/nodes.
2. Spike an `eve` runtime in the platform: one shared pod per organization, N agents. Success criteria: 200 agents under 1.5 GiB, template-derived agent behaves, per-agent LLM-gateway key cost attribution, scheduled work fired by the API.
3. Test the code-reviewer sandbox in a disposable cloud server with single-node k3s: Sysbox then gVisor, running the bulk download, Docker and Testcontainers tests. Kata only on a dedicated server if needed.
4. Try a fresh session per tick and prompt caching to confirm the token savings.

## Reproduce

Needs Node 24+, a host with `/dev/kvm` for the VM tests, and `npm install --ignore-scripts` (`microsandbox` is pinned to 0.5.10 because Eve 0.80.1 requires `^0.5.0`). Everything below lives in `poc/` (see `poc/README.md`). Key scripts: `scripts/sim-agents.mjs` (fleet sim), `scripts/test-lifecycle.mjs` (lifecycle/capacity), `scripts/test-live.mjs` (one real model call; needs `OPENROUTER_API_KEY` in `.env.local`), `scripts/test-net-bulk.mjs` and `scripts/test-docker-vm.mjs` (network/Docker problems), `scripts/with-kvm.sh` (scope-capped launcher; `SCOPE_MEM` env raises the cap), `scripts/host-monitor.sh` (fsynced 1 Hz host stats). `agent/sandbox.ts` currently selects `just-bash`; the microVM version is in `sim-stash/sandbox.microvm.ts`. Do not run the Docker/network tests on a shared host.

## Cleanup record (2026-10-17 ~15:15Z)

Removed on dev: `~/raphie-prototype` (554 MB), `~/.microsandbox` (634 MB) including six stopped `eve-sbx-*` VMs, `~/.config/eve`, `~/.config/varlock`, and today's `~/.npm/_logs` files. Verified: no remaining processes, no systemd units, no cron entries, no leftover VMs. Not touched: the shared `~/.npm` package cache (755 MB, shared with other tools), Docker, system packages, groups and device permissions (we never changed any). The OpenRouter key lived only in the deleted `.env.local`; consider rotating it if you want it gone entirely. Results and sources were copied here first; `.env.local` was not.
