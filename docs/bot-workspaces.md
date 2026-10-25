# Durable lightweight bot workspaces

Each bot has one virtual `/workspace`, shared by its sessions. Ask the bot to
write a note or process files with `workspace_exec`. The tool takes only a command;
bot ownership and session identity come from the admitted turn. Other bots have
separate stores and cannot select this workspace through tool arguments.

The runtime interprets supported shell syntax using pinned just-bash 3.6.0 in a
disposable worker. It installs no host filesystem mounts, inherited environment,
network, Python, JavaScript, native shell or SQLite command. Credential-bearing
MCP integrations remain host-side tools with their existing approval policy.
This is logical separation and bounded interpretation, **not OS or VM isolation**.
The process account and installed dependency code remain trusted.

Only virtual `/workspace` files are durable; `/tmp` and other virtual paths are
scratch. Every execution starts in `/workspace` with fresh shell variables and
process state. Supported files, directories, permissions, timestamps and symlinks
are checkpointed. Binary content is preserved. Hard links are materialized as
independent files between executions. Symlinks refer only to the virtual
filesystem; links to scratch files become dangling after an execution.

Executions are queued in admission order within a bot, including across its
sessions. Different bots can execute concurrently. A shell exit of zero commits
the files; a nonzero exit, worker failure, interruption, limit breach or timeout
discards that execution's changes. A command can handle a normal command error
and exit zero, as in a shell. Inspect `exitCode` and `committed` before claiming
success. Local workspace edits need no separate tool approval; they cannot
perform an external service action.

## Per-bot sandbox settings (native sandbox Slice 1)

**Sandbox** settings persist the bot’s provider, idle period and optional container
disk quota. Existing and new bots default to `just-bash`, 10 idle minutes and no
disk limit (`diskQuotaMiB: null`). No settings import or file migration is needed.
Idle minutes must be an integer from 1 through 1440. A supplied quota must be a
positive safe integer in MiB; an omitted or null quota means no limit.

Only `just-bash` is available. The provider catalog also lists `container` as
unavailable with “Container provider is not implemented yet”. Selecting it is
disabled in the UI; an owner API save requesting it returns 409 without changing
settings. There is no fallback. Idle time and quota are saved now for the future
container provider and have **no effect on just-bash**. Its fixed execution,
checkpoint and file limits below remain unchanged. This slice starts no container
and delivers no native execution, idle shutdown or quota enforcement.

The editor uses Save/Discard and blocks navigation while dirty or saving. Polling
preserves drafts; a newer settings revision blocks a stale save and Discard loads
the latest settings. Saves serialize with message admission and return 409 while
that bot has pending turns. Other bots have independent settings and revisions.
Settings are trusted host configuration in a separate `sandbox_settings` table in
that bot’s `workspace/checkpoint.sqlite`; they are never sent to the worker or
exposed as virtual files. Settings revisions are independent of file revisions,
so a settings save does not invalidate a pending file download.

`GET /api/workspace` adds `settings` and `providers` to the existing active provider,
usage, capabilities and fixed limits. `POST /api/workspace/settings` takes
`{ provider, idleMinutes, diskQuotaMiB?, revision }` and returns the saved settings
with an incremented revision. Unknown fields, including caller-selected bot IDs,
are rejected. Named bots use `/api/bots/<bot-id>/workspace/settings`; the existing
local owner checks and selected bot routing supply the settings capability. There
is no agent tool for reading or changing sandbox configuration.

Runtime coverage is in `packages/runtime/test/sandbox-settings.test.ts`; web
query/rendering coverage is in `apps/web/test/sandbox-settings.test.tsx`. Run
`scripts/check-sandbox-settings.browser.js` on the disposable fixture’s Sandbox
page for save, discard, navigation guard, concurrent edit and unlimited quota
acceptance checks. These checks use no external model calls.

## Checkpoints and recovery

The host owns `<bot-data>/workspace/checkpoint.sqlite`, outside the worker. It is
not a mounted guest file. The directory is private and the database is owner-only.
Do not edit it while the bot is running. Back it up with the other bot stores.
The successful checkpoint and a stable execution receipt commit in one SQLite
transaction. A recovered tool call reuses its receipt instead of repeating an
append or other file edit. Conflicting retries are rejected. Receipt IDs are
host-derived and include the tool task/call and conversation identities.

Restart starts from the last committed checkpoint. Interrupted computation has no
external side effects and may safely run again from that checkpoint if Pi resumes
its tool task. Opening a replacement workspace executor increments a persistent
generation. Older executors and their queued requests cannot commit after that
point. A worker receives copies of files and can only return a candidate
checkpoint; it cannot write durable storage. This does not permit two runtime
processes to own the same Gateway store: stop the old runtime before upgrading.

## Bounds

- Five seconds per execution, including worker startup, with an independent host
  deadline that terminates the worker.
- 16 KiB command source, 32 KiB shell output, 8 MiB retained file content,
  1,024 durable entries and 12 MiB serialized checkpoint.
- Hardened just-bash limits plus 2,000 commands/loop iterations and bounded
  expansions, traversals and archive input/output. These are interpreter budgets,
  not an OS-enforced process memory quota.
- At most 16 admitted executions per workspace, including the running operation,
  and four simultaneous lightweight workers across the runtime. Busy capacity
  returns an explicit error; it does not consume model-generation or VM budgets.
- 16 MiB of retained execution receipts and a 32 MiB SQLite page ceiling per bot.
  Receipts are never silently evicted, because eviction could replay old writes.
  At capacity, further operations stop. Receipt archival and bulk workspace export are future work;
  preserve the store and its backups rather than
  resetting receipts. SQLite transaction journal space is additional transient
  disk use. Failed execution outputs also consume receipt space.

The dependency is Apache-2.0. The lockfile pins its dependencies; a scoped override
updates only guarded-fetch's Undici dependency to patched 7.30.1. Existing Undici 6
users stay unchanged. Optional native package install scripts remain blocked;
they are not required for the workspace interpreter.

VM/native escalation, bulk filesystem imports/exports, cross-bot sharing,
OS memory containment, and separate model-generation concurrency policy remain
future work. No VM is reserved per bot or session.

Verification: `bun test packages/runtime/test/bot-workspace.test.ts
packages/runtime/test/workspace-compute.test.ts`. Full gate: `bun run validate`.

Crash acceptance additionally kills a real process during compute and after a
checkpoint commit but before Pi records the tool result. Recovery preserves files
and does not repeat an append. Tests inject a failed checkpoint transaction to
prove the receipt rolls back with the files, and fill the receipt budget to prove
new work stops while committed retries still resolve. Output-format, filesystem
copy, entry-count and timeout probes verify rollback and continued usability.

Initial delivery verification on 2026-10-24: `bun run validate` passed (150 tests, architecture,
formatting, lint, type checks and production build). Production dependency audit
returned no findings. An isolated browser verified identity/fixture labels and
keyboard expansion at 320/768/1024/1440 pixels, Backend connection details and
the floating composer, with no page errors or horizontal overflow. User runtimes
and data were not used for testing.

## Sandbox visibility and workspace files

Open **Settings → [bot] → Sandbox** to see the active execution provider and version,
capabilities, checkpoint policy, admitted execution count, file usage and resource
limits. just-bash is currently the sole provider. Provider selection and policy
editing remain runtime-managed; this page reports the actual policy rather than
presenting unavailable alternatives. Execution providers operate on the bot-owned
workspace; replacing compute does not replace workspace ownership.

**Settings → [bot] → Workspace** browses the latest committed checkpoint. Open
folders with the keyboard or pointer, use the breadcrumbs or parent button to go
back, and download individual regular files. Sizes are actual decoded byte sizes;
modification times use the browser's local timezone. The view refreshes every five
seconds and has a manual refresh. Downloads preserve binary content and Unicode
filenames and are served as attachments with an octet-stream content type.
Symbolic links are identified and never traversed or downloaded. File previews,
editing, uploads and folder archives are not included.

Reads do not run a command or wait for in-progress execution. Uncommitted files
remain invisible. Downloads carry the revision shown in the listing; a changed
checkpoint returns a conflict and asks for a refresh rather than returning
unexpected bytes. Bot and backend switching retire pending download responses.
No host paths, settings stores, credentials or execution receipts are exposed.

The owner file-read HTTP surface is `/api/workspace`, `/api/workspace/files?path=`
and `/api/workspace/download?path=&revision=`. Named bots use the existing
`/api/bots/<bot-id>/workspace` prefix. Paths refer only to virtual `/workspace`;
traversal, missing files, directory downloads and symbolic links are rejected.
Normal local Host/Origin protection applies to every read. Listings contain at
most the checkpoint's 1,024 entries, without file contents. Download content is
bounded by the workspace's file budget.

Verification adds `packages/runtime/test/workspace-http.test.ts` and the scoped
binary download test in `apps/web/test/backend-workspace.test.ts`. Browser checks
cover responsive layout, keyboard folder navigation, exact text/binary/Unicode
downloads and cross-bot empty state. Tests use synthetic, separate bot stores.

Visibility follow-up verification: `bun run validate` passed with 152 tests,
architecture, formatting, lint, type checks and production build. The separate
browser fixture passed at 320/768/1024/1440 pixels with no page errors or horizontal
overflow; folder focus, exact downloaded bytes, Unicode filenames and switching
to another bot’s empty workspace were verified.

## Container backend (native sandbox Slice 2)

The backend-only `ContainerWorkspace` implements Pi's `ExecutionEnv` and is covered
by real-container tests, including Pi's `registerEnvConformance()` suite. It is
**not installed in any bot, Pi tool registry, HTTP route or web page**. The catalog
still rejects selecting `container`. Existing workspaces continue using just-bash;
no checkpoint files are migrated. Slice 3 owns tool and file-browser integration.

The trusted caller supplies the bot's data directory, stable workspace id and saved
`idleMinutes`/`diskQuotaMiB`. Default-bot storage is `<data>/workspace/`; named bots
use `<data>/bots/<id>/workspace/`. Only its `files/` subdirectory is bound read-write
at `/workspace`. `container.sqlite` (epoch, installation scope and command journal)
and the existing `checkpoint.sqlite` are siblings outside that mount. No host
home, settings, data-directory mount, credentials, Docker socket or published ports
are supplied. Docker's automatic proxy environment injection is explicitly cleared.
Docker still provides its ordinary guest `/etc/hosts`, hostname, resolver and kernel
pseudo-filesystems; these are not additional application data binds.

All file operations, including readers and watchers, run **inside** the container.
The host bundles Pi's pinned `NodeExecutionEnv` and sends it to `docker exec node`
over an argv/stdio transport. It never constructs that environment on the host.
A link to `/etc/passwd` therefore sees the image's file, not the host's. Parent and
absolute host-path symlinks cannot expose host files or the control database.
Readers and watchers belong to that container lifetime and must be reopened after
idle shutdown, interruption or replacement. Each session's environment view has the
same workspace id; the provider serializes all operations across its views.

One container starts lazily per bot. Removal after the idle interval ends all its
processes; the bind-mounted files remain, and the next operation creates fresh
compute. The clock is injectable and `stopIfIdle()` permits explicit sweeps. Work
in other bots can run concurrently. Runtime-process budgets are four running
containers and four active operations, with sixteen admitted operations per bot.
Idle containers consume container capacity until reaped. These budgets do not
coordinate independent runtime processes; existing runtime ownership rules still
prohibit concurrent Gateways over one data directory.

Each guest uses a non-root uid/gid, all capabilities dropped, no-new-privileges,
a read-only root, a 64 MiB `/tmp` tmpfs, 512 MiB memory, one CPU and 128 PIDs. The
fixture runs with the runtime owner's uid/gid (or 1000 when the host runs as root);
root-owned installations need appropriate workspace ownership before use. All CLI
arguments use argv with no host-shell interpolation. Command source is bounded to
16 KiB encoded, returned shell output to 32 KiB, and one RPC response to 24 MiB.
Guest operations have a 30 second host deadline, shortened by a requested timeout;
each synchronous CLI lifecycle command separately has a 30 second timeout. Startup
is additional to the guest deadline. Synchronous lifecycle calls hold a SQLite
write lock to prevent races with another owner's startup; a slow daemon can block
the runtime event loop during these calls. This is a backend limitation to revisit
before enabling the provider for interactive bots.

A command timeout, abort, output breach or transport loss removes the entire owned
container. This includes process groups and detached `setsid` descendants, and also
invalidates open guest readers/watchers. Successful commands may leave processes
running until idle stop or replacement. Files already written remain after a failed
or interrupted command; there is no checkpoint rollback for this provider.

Opening the provider reaps that bot's labelled stale compute **before** publishing
a newer persistent epoch. It marks unfinished intents `interrupted`, never replays
them, and fences queued/stale operations and receipt writes. All inspect/removal
operations first filter at the daemon by `raphie.workspace` and the persisted
installation `raphie.scope`; test names use `raphie-test-`. `execute()` accepts a
trusted operation id: committed receipts deduplicate retries and retain bounded streamed output, conflicting arguments
are rejected, and interrupted retries return an unknown-outcome error. `history()`
surfaces interrupted intents for the future caller/UI. `env.exec()` creates a fresh
operation id; slice 3 must use trusted durable call identities where retries need
receipt lookup. The journal is bounded to 10,000 mutation/command intents; at
capacity new mutations stop, reads and committed retries still work, and old
receipts are never evicted. Archival is not implemented.

An optional disk quota checks `du -sk /workspace` before a command or an operation
that grows files. `null` skips this check. Over-quota commands are refused before
submission; file reads and direct removal remain possible. This is an admission
check on allocated blocks, **not** a filesystem quota: a running command or its
background process can exceed it. The host free-space floor remains slice 4.

### Network limitation: host and LAN access are possible

Bridge networking is on by default. CLI-only portable flags do **not** provide the
ADR's intended internet-only egress policy on OrbStack, Docker Desktop or Linux.
No application-layer hostname check could enforce that policy against arbitrary
native programs, DNS changes or direct IP connections. This backend installs no
host firewall rules, privileged filtering containers or credential proxy.

Real probes on Docker 29.8.2 / OrbStack, 2026-10-25, found:

- Public internet TCP access succeeded.
- Container `127.0.0.1` and `::1` could not reach the host fixture ports (connection
  refused), but **`host.docker.internal` reached a host fixture bound only to
  `127.0.0.1`**, as well as a wildcard-bound fixture.
- The wildcard fixture was reachable via the host's private LAN address and VPN
  interfaces (including a `100.64.0.0/10` address). Host/LAN separation is absent.
- The Docker bridge gateway (`192.168.215.1`) refused the fixture connection.
  Other tested host bridge addresses timed out. Neither result proves filtering.
- TCP probes to `10.0.0.1` timed out or were refused across runs; probes to
  `172.16.0.1`, `192.168.0.1` and metadata `169.254.169.254` timed out in the
  initial runs. A later manual-test run reached `192.168.0.1:80`, further
  confirming LAN exposure. No controlled service exists at those addresses in
  this test, so **private-range and metadata denial were not established**.
  `fd00::1` was unreachable; that does not establish IPv6 egress filtering.

OrbStack [documents Mac host access](https://docs.orbstack.dev/docker/network), and
Docker Desktop [provides host/gateway DNS names](https://docs.docker.com/desktop/features/networking/networking-how-tos/).
Linux Docker [places filtering policy in host firewall chains](https://docs.docker.com/engine/network/firewall-iptables/).
No Desktop/Linux firewall policy or Podman behavior was verified here. Docker
bridge peers may also communicate. Container/kernel escapes remain possible;
this is not VM isolation. Before enabling container bots, the owner must choose
and verify an enforceable egress boundary or explicitly accept this network gap.
The credential proxy, authenticated sandbox writes and audit flow remain slice 5.

### Running the backend tests

The fixture image pins `node:22.16.0-alpine3.22` by digest and adds `git`/`rg`.
It is a test baseline, not the final supported image/toolchain or security-update
policy. The dependency stays at the repository's pinned Pi version; no Docker SDK
or new npm dependency is added.

```sh
docker build -t raphie-workspace:slice2 packages/runtime/test/fixtures/container
bun test packages/runtime/test/container-cli.test.ts \
  packages/runtime/test/container-workspace.test.ts \
  packages/runtime/test/container-boundaries.test.ts --timeout 30000
bun run validate
```

Varlock declares `RAPHIE_CONTAINER_BINARY` (default `docker`) and
`RAPHIE_CONTAINER_IMAGE` (default local fixture tag `raphie-workspace:slice2`). An
owner may override the image with an immutable compatible reference. Image builds
are explicit; tests skip with a clear message when the CLI/daemon or fixture image
is unavailable. A skipped run is not isolation verification. Tests use temporary
directories, fixture services and only their labelled/prefixed containers. They
clean up on success and failure, including a real killed-runtime subprocess.
The network test prints observations without assuming a timeout means denial.

Slice 2 verification on 2026-10-25: `bun run validate` passed with 205 tests,
zero failures and zero skips, including 36 real-container cases (24 Pi conformance
cases) and two CLI/transport unit cases. Architecture, formatting, lint, type checks
and the production build passed; Vite reported its chunk-size advisory. A separate
missing-binary run exited successfully with twelve explicit skips and clear runtime
messages. Scoped `finally` and `afterAll` cleanup left no labelled test containers.
Varlock masked schema validation and staged scans passed. No model calls, live bot
data, host firewall changes, bot/provider activation, push, deployment or PR were
part of verification.
