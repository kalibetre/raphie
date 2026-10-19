# Eve + microsandbox prototype: VM activity log

## Scope and safeguards

- Target authorized by owner: `<user>@<dev-host>`.
- Existing development VM: 8 vCPU, 20 GiB RAM. Preserve existing workloads and data.
- Initial phase: read-only inspection. No reinstall, disk formatting, service restarts, package installation, or configuration changes.
- Explain any required host-level changes before making them.
- Initial sandbox concurrency: one, with a maximum of two until resource headroom is measured.
- Record commands, outcomes, changes, and cleanup instructions here. Do not record secrets.

## 2026-10-17: initial inspection

### Local workspace

Command: `ls -la`

Outcome: workspace is empty; no existing project files were changed.

### Connection attempt 1 (restricted execution)

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 <user>@<dev-host> 'hostname; uname -srmo; cat /etc/os-release; nproc; free -h; df -h /; uptime; test -c /dev/kvm && ls -l /dev/kvm; id; command -v node; command -v pnpm; command -v docker; command -v msb; ss -ltn'
```

Outcome: exit 255, `ssh: Could not resolve hostname <dev-host>: nodename nor servname provided, or not known`.

No remote commands executed. Next action: retry the same read-only inspection with network access outside the execution sandbox to determine whether its restrictions caused the hostname failure.

### Connection attempt 2 (network access enabled)

Command: the same SSH inspection command as attempt 1, run with elevated network access authorized by the execution approval system.

Outcome: reached the host. SSH reported that an additional identity check was required and supplied an interactive verification link. The user must complete this check through their own browser. The temporary authentication URL is kept out of this persistent log.

The SSH process is waiting for authentication. No remote inspection output has been received. No remote commands are confirmed executed and no VM changes have been made. Resume inspection after the owner completes identity verification.

### Authentication completed; inspection succeeded

The owner completed the identity check. The waiting SSH command completed successfully. A second read-only inspection was run from the versioned command source `scripts/inspect-host.sh`:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 <user>@<dev-host> 'bash -s' < scripts/inspect-host.sh
```

Full follow-up output: `docs/host-inspection.txt` (2026-10-17T10:46:47Z).

Findings: Ubuntu 24.04.5, Linux 6.8 x86_64, 8 vCPUs, Intel i9-13900H, VT-x visible inside KVM guest; approximately 19.5 GiB RAM, 9.2 GiB available, no swap; approximately 251 GiB disk available. Existing Docker/Kubernetes and development services are running. Node 26.10.0 and npm 11.19.1 are installed. No pnpm or microsandbox executable was found on PATH.

`/dev/kvm` exists but current user lacks read/write access. Passwordless sudo is available. Before proposing any group/device configuration change, test a process-only launch using `sudo -n -u <user> -g kvm`; this changes no persistent host configuration.

No remote files, packages, services, or configuration have been changed. Reserve at least 5 GiB available RAM for existing development work; do not run fleet-wide load tests on this shared machine.

### Package metadata and access checks

Read-only commands run over SSH:

```sh
sudo -n -u <user> -g kvm sh -c 'id; test -r /dev/kvm && test -w /dev/kvm && echo KVM_GROUP_LAUNCH_OK'
ls -l /dev/vhost-vsock /dev/net/tun
npm view eve version engines dependencies --json
npm view microsandbox version engines --json
npm view varlock version --json
sudo -n -l
getent group kvm
python3 -c 'import os; print("KVM_ACCESS", os.access("/dev/kvm", os.R_OK | os.W_OK))'
```

Results: the non-root group override asks for a password, but root-run commands have `NOPASSWD: ALL`. The kvm group exists with GID 993 and no members. `/dev/vhost-vsock` is also owned by root:kvm. Published versions: Eve 0.80.1 (Node >=24), microsandbox 0.7.8 (Node >=22), Varlock 1.23.0. Existing Node 26.10.0 satisfies the package engine declarations.

An interrupted read-only sudo-policy check returned no retrievable output; it was safely repeated once. No mutation was attempted by either check.

### Planned isolated setup

Create only `~/raphie-prototype` for prototype source, dependencies, results, and scratch state. Install pinned npm packages there. Test KVM through a root `setpriv` invocation that drops back to UID 1000 with the existing groups plus kvm (993); no account/group or device-mode edits. Do not change Docker, Kubernetes, existing services, firewall rules, or system packages.

KVM verification succeeded: the process-only group launch returned `KVM_API_VERSION=12` using `scripts/check-kvm.py`. No persistent permission change is required.

Created `~/raphie-prototype/{docs,scripts,results}` using `mkdir -p`. This is the first remote filesystem change. Next: copy the documented prototype sources there and run `npm install --ignore-scripts --no-audit --no-fund`, saving its output under `results/install.log`. Lifecycle scripts are disabled until their behavior has been inspected. All files are owned by the regular user.

File transfer completed (macOS tar extended-attribute warnings only). Initial dependency install failed with `ERESOLVE`: Eve 0.80.1 declares optional peer `microsandbox@^0.5.0`; the separately published latest microsandbox 0.7.8 is incompatible. Do not use `--force` or ignore the peer constraint. Revised the prototype pin to microsandbox 0.5.10. The failed install log is retained as `results/install.log`; retry output will use `results/install-compatible.log`. npm also wrote its normal cache/log files under the user's `~/.npm` directory.

Compatible dependency installation succeeded: 39 packages. Read package metadata, bundled documentation, sandbox/model/client declaration files, and `eve build --help`; no installation hooks were enabled. `node node_modules/microsandbox/bin/microsandbox.cjs --version` reports `msb 0.5.10`: the native runtime is already packaged, with no global installation needed. Discovered OpenAI-compatible provider package version 3.0.71.

Next launch uses `scripts/with-kvm.sh`: a transient systemd scope limited to 2 GiB total memory, 150% of one CPU, and 256 tasks. It drops root privileges before running prototype code and adds kvm only for that process. It refuses to start if host available RAM is below 5 GiB. This creates no persistent service and edits no group/device configuration. First test creates exactly one uniquely named `raphie-smoke-*` Alpine microVM (1 vCPU, 512 MiB), writes only a guest marker, then stops and removes that VM. Image/runtime cache files may be created under `~/.microsandbox`; they must not be confused with existing Docker resources.

### First real microVM passed

Ran `bash scripts/with-kvm.sh timeout --signal=TERM --kill-after=15s 180s node scripts/sandbox-smoke.mjs` with output in `results/sandbox-smoke.log`.

Result: `raphie-smoke-1792234379705` booted in 4403 ms (first-image setup included), ran guest Linux 6.12.68, wrote and read `raphie-ok`, then stopped and was removed. Report: `results/raphie-smoke-1792234379705.json`. This proves nested virtualization and native guest execution, not agent throughput.

Read installed Eve model/session/provider APIs and microsandbox setup APIs. `@ai-sdk/openai-compatible@3.0.71` is the published provider version selected for the model adapter. Package read commands did not access credential files. A read of a nonexistent older documentation filename failed harmlessly; corrected to the installed `docs/agent-config.md`.

Next slice: install the pinned model adapter; build one Eve agent using one 512-MiB microsandbox and a local deterministic model on loopback port 4311. Eve will bind loopback port 4310. Both were unused during inspection. The guest network is deny-all, and no OpenRouter key is configured or needed for mock tests. Preparation will pull a Node 24 Debian OCI image and store its prepared snapshot in prototype/Eve/runtime caches. No existing Docker container will be stopped or deleted.

The provider adapter installed successfully. The first Eve build failed before creating a template: Eve's runtime discovery does not recognize the SDK's packaged native binary automatically when auto-install is disabled. The direct SDK microVM test already proved that binary works. Set `MSB_PATH` explicitly to the pinned package's `bin/msb` in the prototype launcher; do not run a global installer. Build output retained in `results/build.log`; retry in `results/build-explicit-runtime.log`.

The explicit-path build failed with the same discovery error. Minimized the failure to `microsandbox.isInstalled()`: it returns false even though the packaged `msb --version` succeeds. Explicitly registering the packaged libkrunfw path also left it false. Eve calls this installer-status check before invoking the runtime, so passing a binary path alone is insufficient. No dependency files were patched.

Next, use the SDK's documented `setup().version('0.5.10').install()` to populate the user-local runtime installation under `~/.microsandbox`, then assert `isInstalled()`. This is a user-local tool install (no apt, system-wide binaries, service, permissions, or account changes). Keep all output in `results/runtime-setup.log`. Repeat build only after that diagnostic passes. The initial runtime/library-path hypotheses were insufficient; the observed blocker is Eve's mandatory installer-status preflight.

User-local runtime setup passed, then the Eve build succeeded and prepared its Node 24 Debian VM template. Output: `results/runtime-setup.log` and `results/build-installed-runtime.log`. Existing dependency files were not patched. Model selected by owner: `anthropic/claude-haiku-5.5`; recorded in `.env.schema` without a key. Availability has not been tested.

Next verification: `scripts/test-lifecycle.mjs` starts only prototype-owned loopback services on 4310/4311, creates one Eve session, executes a marker-writing bash command in its real VM, restarts only that Eve child process, reads the file through the same durable session, then creates a second session and checks that it cannot see the marker. Resets its own sessions and stops its own child processes afterward. Runs in the same transient 2-GiB/1.5-CPU scope with a 240-second deadline. Outputs are prototype fixture data only; no real model or credentials are used.

### Eve lifecycle verification passed

`results/test-lifecycle.log`: all three checks passed between 10:58:07Z and 10:58:27Z. Created sessions were reset and test child services stopped. A diagnostic `tail -16` command was rejected by the remote shell's tail implementation; it made no changes and was unnecessary because the test completed successfully.

Next guarded measurement: repeat lifecycle checks, register 100 durable sessions (without messages), assert that registration adds no running VMs, then measure controlled fixture commands at concurrency 1 and 2. This is explicitly not a 100-active-VM test. Sample available host memory and scope memory, stop admission below 5 GiB available, retain the hard 2-GiB/1.5-CPU scope. Reset only the sessions created by the runner. Deadline 300 seconds; output `results/test-capacity.log` plus a timestamped JSON report.

First guarded capacity run passed: 100 total sessions registered, zero additional running VMs for idle registration; concurrent API turns at 1 and 2 passed. These short fixture commands completed in under 500 ms, too quickly for the interval sampler to prove simultaneous active VM execution. Strengthen the fixture with a 2-second guest wait and assert sampled running-VM overlap; repeat in `results/test-capacity-overlap.log` rather than treating short-request timings as throughput evidence.

Ran `npm run config:check`: Varlock validated mock mode and the selected model with no secret printed. Queried the unauthenticated public OpenRouter `/api/v1/models` catalog and found the exact selected model with tool calling support. No paid model calls were made. Copied the prototype's generated `package-lock.json` back to the local workspace using SSH. Asked the owner to configure the key privately on dev; do not read `.env.local` or include it in file transfers.

### Live OpenRouter run and overlap capacity (2026-10-17 ~11:00–11:14Z)

The owner's `.env.local` had a typo (`MODLE_MODE`). Renamed that key in place with `sed` (value untouched, never printed); `varlock load` then validated `MODEL_MODE=openrouter` and a masked key. Added `limits` to `agent/agent.ts` (60k input / 8k output tokens, $0.25 cost per session), rebuilt, and added `scripts/test-live.mjs`.

Live run (`anthropic/claude-haiku-5.5`, one session, one microVM): wrote and ran `fib.js` in the guest via the bash tool, correct output, 3.5 s, 4194 input / 169 output tokens. Session was reset afterwards. This proves Eve -> OpenRouter -> tool call -> real microVM end to end.

Overlap capacity run (mock model, 100 registered sessions, then concurrency 1 and 2 with a 2 s guest wait): passed on the third attempt. Sampler observed `peakRunningVMs` = 2, idle registration added 0 VMs, scope peak 761 MiB, host available never below ~10.8 GiB.
- Attempt 1 produced no report: the SSH pipe was cancelled, and the run ended without writing a lifecycle JSON.
- Attempt 2 failed: one VM boot from the template snapshot timed out ("timed out waiting for agent relay") after ~3 min, directly after the killed run. The same Eve process also logged ~200 "Queue delivery failed ... retrying" lines for workflow runs left by the earlier killed attempt, so durable sessions from a dead run are replayed on the next start.
- Attempt 3 passed on a clean host. Treat the boot timeout as an unexplained flake, not a fixed bug.

Still unknown: real concurrency ceiling, cold-boot time under load, per-session cost of a long agent run.

### Cron-style fleet simulation, no VMs, no real tokens (2026-10-17 ~11:35–11:50Z)

Direction change from owner: real agents run on cron (not idle), do not need a full VM, carry soul/memory/skills/templates files and call external services; tests must not spend tokens.

Changes: `agent/sandbox.ts` now uses Eve's `just-bash` sandbox (pure-JS shell + virtual FS, `just-bash@3.1.0` installed with `--ignore-scripts`); the microVM version is kept at `sim-stash/sandbox.microvm.ts`. Added 12 skills, 3 templates (baked in via `prepare`), `agent/tools/call_integration.ts` (HTTP to a mock with 50-300 ms latency and 2% 503s), a scripted mock model (`RAPHIE_PLAN`) with `/stats`, and `scripts/sim-agents.mjs` (staged fleet, compressed clock, resource guards). The sim blanks `OPENROUTER_API_KEY` and forces `MODEL_MODE=mock`, so any accidental real call fails rather than spends. Eve auto-loads `.env.local`, so keep that in mind for any other script.

Result (`results/sim-1792237535864.json`): agents 50 / 150 / 300, one tick per agent per 60 s (15x compressed from a 15-minute cron), ~85% light / 12% medium ticks, 3% "needs a real VM" ticks counted but not run. 0 errors, 0 overruns, tick latency p50 ~300 ms, p95 ~750 ms, p99 ~950 ms at all three sizes. Process-scope memory 499 / 673 / 1028 MiB. Host available memory never below 7.4 GiB. No guard tripped, so the ceiling was not found.

Findings:
- Prompt size per model call: ~780 system + ~1230 tool schema tokens fixed; conversation tokens grew 4.5k -> 6.0k -> 7.2k as long-lived sessions accumulated history. ~47k -> 62k input tokens per tick (5 model calls). At the catalog price for claude-haiku-5.5 ($0.10/M input, $0.50/M output, $0.01/M cache read) that is ~$0.005-0.006 per tick, ~$0.5-0.6 per agent per day at 96 ticks/day with no prompt caching.
- Eve's local workflow store (`.eve/.workflow-data`) grew to 434 MiB / 97,654 files for 300 agents after ~7 minutes, roughly 100 files per tick. Needs a retention/storage decision before long runs.
- The `peakEveRssMiB` metric samples the launcher PID and is not trustworthy; use `peakScopeMiB`.
- Earlier "Queue delivery failed" noise was backlog replay from the killed run; a clean run logged none.

### Docker inside a microVM (2026-10-17 ~12:30-12:52Z)  **host crash during test**

Read-only probe of the Alpine microVM guest kernel (6.12.68): overlay fs registered, cgroups v1+v2, all namespaces (net/pid/mnt/uts/ipc/user) via `unshare`, veth pair creation works, iptables/netfilter tables present, /dev/fuse present. No /proc/config.gz, no loadable modules. (The one overlay-mount failure in the probe was a probe bug.)

`scripts/test-docker-vm.mjs` (docker:dind image, 2 vCPU / 2560 MiB guest, public-egress policy, 4 GiB scope cap via new `SCOPE_MEM` in `with-kvm.sh`):
- Attempt 1: dockerd failed, "failed to mount overlay: invalid argument" (overlay2 cannot sit on the guest root, which is itself an overlay).
- Attempt 2: `/var/lib/docker` on a 1536 MiB tmpfs. dockerd started in 0.6 s (overlay2, cgroup v2); `docker run alpine` pulled and ran an inner container in 4.8 s. Then step 3 (apk add python + pip install pytest/testcontainers/pg8000) was running when the dev host went unreachable. It had rebooted by ~12:51Z (`last` shows reboot 12:51; previous boot ended with no shutdown records; the on-disk journal stops at 12:36:27, which only shows what had been flushed). No kernel panic/OOM evidence survived. VM left in "crashed" state; removed.

Cause not established. Only this test was running under my account; the host is itself a VM and other workloads (e.g. a reconciliation loop, confd) share it, so the reboot interrupted them. Do not rerun on this host without the owner's go-ahead. Testcontainers + Postgres is still untested.

### Docker/Testcontainers retry on dev (2026-10-17 ~14:20-14:47Z) — owner chose "retry on dev with a smaller test"

Safeguards added: `scripts/host-monitor.sh` (1 Hz, fsynced), a host guard inside the tests (abort if available RAM < 6 GiB or load > 6), 1 vCPU / 2 GiB guest, tmpfs 1 GiB for Docker, stage selection (`--through alpine|pg|py|tc`). No host crash this time.

- Docker works in the guest: dockerd (overlay2 on tmpfs, cgroup v2) starts in ~0.6 s; pulling and running `alpine` inside the microVM takes ~4.8 s.
- Pulling `postgres:16-alpine` (bulk download) makes the guest stop responding: every probe from 10 s after the pull starts times out, three runs in a row (one boot failure with "timed out waiting for agent relay" on a fourth attempt, as seen earlier).
- Isolated, no Docker: `scripts/test-net-bulk.mjs` — bare Alpine VM (1 vCPU / 1 GiB, `NetworkPolicy.publicOnly()`) running `wget -O /dev/null` of an Alpine ISO. rx counter advanced 10 -> 18 -> 28 -> 42 MiB (~2 MB/s) and the guest became unresponsive at ~25 s (rx > ~42 MiB); guest memory was free (995 MiB). So the trigger is bulk network transfer through the microVM's network path, not Docker and not memory.
- Likely the same trigger as the 12:51Z host reboot (it happened during `pip install`, another bulk download), but that link is unproven: the host did not crash in this reproduction, and no logs from the crash survived.

Not yet done: Testcontainers + Postgres (blocked on bulk downloads), any network-setting variants (policy, MTU, TLS interception), microsandbox 0.7.8 standalone (Eve pins ^0.5.0; a leased-VM tool using the SDK directly is not bound by that).

### Cleanup of the dev machine (2026-10-17 ~15:15Z)

Owner asked to remove everything created for the experiment. Inventory first (read-only), copied results and sources back to this directory (no `.env.local`), then removed: six stopped `eve-sbx-*` microVMs via `msb rm`, `~/raphie-prototype`, `~/.microsandbox`, `~/.config/eve`, `~/.config/varlock`, and today's `~/.npm/_logs` files. Left alone: shared npm cache, Docker, system packages, anything not created today by this work. Verified afterwards: paths gone, no related processes, systemd units or cron entries, host healthy (load 0.3, 12 GiB available). Summary of the whole experiment: `EXPERIMENT-REPORT.md`.
