---
status: proposed
---

# Native bot sandbox for real repositories and CLIs

Proposed 2026-10-25, building on [ADR 0002](0002-bot-owned-workspaces-and-temporary-compute.md).
The delivered just-bash workspace is an in-memory interpreter with an 8 MiB
checkpoint, no network and no `git`. It suits notes and small scripts, not
cloning a repository, running `gh`, or editing a project. This decision adds a
second execution provider with a real disk workspace and real processes, and
keeps just-bash as the lightweight option. See
[the delivered limits](../bot-workspaces.md).

## Decision

Use Pi's own coding tools. `@earendil-works/pi-durable/tools` provides `read`,
`write`, `edit` and `bash`, which reach files and processes only through an
`ExecutionEnv` that the host builds for each call from the conversation. Raphie
supplies an `ExecutionEnv` backed by a per-bot container. Pi already commits
tool intent durably and refuses to replay a tool that is not declared
replay-safe, which matches ADR 0002's rule that uncertain outcomes stay
uncertain.

The bot is resolved from the conversation, never from tool arguments. The
environment `id` is the bot's workspace id, so every session of one bot sees the
same files.

## Owner decisions (2026-10-25)

1. **Lifetime:** the container stops after an idle period. The period is a
   per-bot setting in minutes. Files persist; processes and shell state do not.
2. **Disk:** no quota by default. A quota is an optional per-bot setting, and
   usage is shown in settings.
3. **Network:** on by default, because the bot must clone, fetch and call APIs.
4. **Tools:** not specific to git. The bot may use `gh` and any CLI installed in
   the image, so credential handling must be generic, not a git-only helper.
5. **Writes:** the bot may push and otherwise write to remote services.

## Architecture

- One container per bot, started on demand, with the bot's folder
  (`<data>/bots/<id>/workspace`) as its only writable mount. No host home,
  settings database, Docker socket or Raphie data directory is mounted.
- A `WorkspaceEnv` implements Pi's `ExecutionEnv` over that container
  (`exec`, file reads and writes, directory listing). The Sandbox and
  Workspace files pages read through the same environment instead of a
  checkpoint.
- A per-bot lease serializes commands and carries the existing epoch fence, so a
  replaced runtime or a stale container cannot act after a newer owner starts.
- Provider is a per-bot choice: `just-bash` (today), `container` (first), `vm`
  (later). The Sandbox page already presents provider as a setting-shaped
  value.

## Credentials with open network

The sandbox never holds a real credential. Because network and arbitrary CLIs
are allowed, an environment-variable token would be readable by anything the
bot runs and could be sent anywhere.

- Outbound traffic goes through a host-side egress proxy.
- The owner grants a bot named credentials per host, for example
  `api.github.com` and `github.com` to one token. The sandbox sees only a
  placeholder, such as `GH_TOKEN=placeholder`, so `gh` and `git` start normally.
- The proxy replaces the placeholder with the real value for the granted hosts
  and strips it elsewhere. HTTPS requires the proxy to terminate TLS using a CA
  installed only in that sandbox image. This is the same approach as Docker
  Sandboxes, which Pi documents.
- Scope is the control for writes. Grant fine-grained tokens limited to chosen
  repositories and permissions. Each push, issue or PR creation and other
  authenticated write is recorded in the audit log with bot, session and host.
  An optional per-bot toggle can require owner approval for authenticated
  writes; it is off by default, per decision 5.

## Intended network policy (not enforced by the Slice 2 backend)

The intended release policy is that the sandbox cannot reach
loopback, the host, private and link-local ranges, cloud metadata addresses or
the Docker socket. Without this, a prompt-injected bot could call Raphie's own
HTTP API or services on the local network. An owner can add exceptions
deliberately. An optional per-bot egress allowlist narrows internet access.

## Limits and resources

CPU, memory and process count are bounded per container, as are wall time per
command and output returned to the model. Unlimited disk is the default, so the
runtime should refuse new work when free host space drops below a floor and
say so, rather than fill the host. Concurrency is a runtime-wide budget separate
from model generation, as ADR 0002 requires.

## Recovery

A container loss or runtime restart leaves the folder intact and ends the
running command. Pi reports it as interrupted. The bot sees that its last
command has an unknown outcome and checks `git status` instead of assuming it
did or did not run. Files already written stay written. There is no checkpoint
rollback in this provider; the working tree is the state.

## Not claimed

A container is a process boundary on a shared kernel, not VM isolation. A kernel
or runtime escape is possible. The `vm` provider (for example a micro-VM) is the
stronger option for servers and is separate later work. The credential proxy
limits what a compromised bot can use, not what it can read inside its own
folder or send over open network.

## Delivery sequence

Slice 2 now delivers a backend-only container implementation, with the network
limitation documented below. It has no credential proxy: the sandbox will hold no
credentials, and authenticated integrations such as GitHub will go through the bot's existing
per-bot MCP connections, which run on the host. Once those slices are delivered,
the bot will be able to clone public repositories, edit, and use local `git`, but
will not be able to push or clone private repositories from inside the sandbox.
It will publish through MCP tools instead. The credential proxy stays the design
for later. Slice 1 below delivers settings only.

1. **Provider settings — delivered (2026-10-25, Slice 1):** provider, idle minutes
   and optional quota persist per bot with optimistic revisions and the existing
   admission gate. Defaults: just-bash, 10 minutes, no disk limit. The owner
   Sandbox page supports guarded Save/Discard. The runtime exposes availability
   and rejects container saves with 409: “Container provider is not implemented
   yet”. Idle minutes (1–1440) and optional positive integer MiB quota are
   validated and stored for future container use; just-bash behavior and fixed
   limits are unchanged. No container runs in this slice. See
   [delivered settings](../bot-workspaces.md#per-bot-sandbox-settings-native-sandbox-slice-1).
2. **Backend delivered (2026-10-25, Slice 2), network policy incomplete:**
   `ContainerWorkspace` implements Pi's `ExecutionEnv`, with only
   `<bot-data>/workspace/files` mounted at `/workspace` and SQLite control state
   outside the mount. Label/scope-filtered CLI operations, durable epochs and
   pre-exec intents, interrupted recovery with no replay, serialized session
   views, runtime-process capacity limits, idle removal, quota admission checks,
   non-root/read-only/capability/resource restrictions and bounded execution are
   covered by real Docker/OrbStack tests. Pi conformance, cross-bot files, shared
   sessions, git init/commit/local clone, restart, actual process crash, container
   loss, detached-process termination, fencing and symlink tests pass.
   **Host-reach denial is not delivered:** `host.docker.internal` reaches even a
   loopback-bound Mac service, and host LAN/VPN interfaces are reachable. Private
   probes were reachable, refused or timed out across runs; metadata probes
   timed out. These observations do not establish blocking. CLI-only bridge
   flags cannot enforce the intended policy portably; no host firewall was
   changed. Desktop/Linux/Podman are unverified. See the
   [backend limits and probe results](../bot-workspaces.md#container-backend-native-sandbox-slice-2).
   The backend was unavailable to bots until the Slice 3 opt-in policy below.
3. **Delivered (2026-10-25, Slice 3), explicit network opt-in:** The owner chose
   disabled-by-default container execution with an acknowledgement of host/LAN
   access. Updated on 2026-10-26: the acknowledgement is now a persisted per-bot
   Sandbox setting (`hostNetworkAcknowledged`, default false), required to save
   Container. It replaces the host-level environment flag and does not filter
   traffic. Pi coding tools use bot-derived environments and trusted durable conversation/task/call identities. Tools are
   unsafe to replay; a real process-crash test proves committed native effects
   are not repeated after Pi recovery. Sandbox usage and Workspace file routes
   read through the environment, with live metadata revisions, bounded browsing
   and downloads. Provider switches retain separate stores without migration.
   Withdrawing acknowledgement requires switching to just-bash. Older Container
   selections without acknowledgement reap stale compute on startup, preserve
   files and expose Sandbox settings while blocking tools/file browsing until
   acknowledged; there is no silent provider fallback. Six required Slice 2 review
   findings were fixed and covered by regressions. Synchronous lifecycle CLI calls were reviewed and retained for
   fence safety; they can still block the runtime event loop for their bounded
   deadline. No credential proxy, host firewall change or VM isolation is claimed.
   See [native integration](../bot-workspaces.md#native-bot-integration-slice-3).
4. **Planned:** Image contents (`git`, `rg`, common runtimes) and a documented way to extend
   them; free-space floor.
5. Later: egress proxy with per-host credential grants, TLS termination, audit
   log and the optional write-approval toggle. Prove that no credential appears
   in the container environment, filesystem or process list.

## Open points

- Slice 2 verifies Docker 29.8.2 on OrbStack only. The binary is configurable via
  Varlock; commands/flags target the common Docker/Podman CLI, but Podman remains
  untested. Which runtime/platform combination is supported for release?
- An enforced host/LAN/metadata egress boundary remains future work. The owner
  accepted an explicit disabled-by-default opt-in for Slice 3; plain bridge
  networking demonstrably exposes Mac host services.
- Whether the image ships `gh` and package managers, or the bot may install
  tools into its own folder.
- Where the CA and proxy run when Raphie itself runs in a container.
- The host free-space floor. The default idle period is now 10 minutes, configurable
  per bot from 1 through 1440 minutes.

## Slice 2 verification

On 2026-10-25, `bun run validate` passed: 205 tests, no failures or skips,
including real Docker/OrbStack acceptance and Pi `ExecutionEnv` conformance.
Formatting, architecture, lint, types and production build passed. A separate
missing-runtime check skipped cleanly; scoped cleanup left no test containers.
See the [workspace guide](../bot-workspaces.md#container-backend-native-sandbox-slice-2)
for exact resource bounds, storage paths, network observations and the remaining
limitations. No user data or model credentials were used for container tests.

## Slice 3 verification

The independent five-axis Slice 2 review found six Required findings and no
Critical findings. All six were fixed in `f3bcd42`, with real-container regression
checks. The baseline full validation passed 205 tests without failures or skips.
Native integration checks additionally cover real Pi coding tools, same-bot shared
sessions, live HTTP files/downloads, provider switches and restart, and SIGKILL
between a committed native command and Pi's unsafe tool result. A storage-failure
regression also verifies that a rejected provider save restores native ownership
and never exposes the wrong file store.

Final `bun run validate` passed on 2026-10-25: **214 tests, zero failures and zero
skips**, including real Docker/OrbStack tests and Pi conformance. Formatting,
architecture, lint, types and production build passed. Native Sandbox rendering
checks cover nullable limits and truthful network/live-write copy. A separate
missing-runtime run exited successfully with two explicit integration-test skips.
Varlock schema validation and staged scans passed. No external model calls or live
user data are used by these tests. A second external Claude review was rejected by
automatic approval due to repository disclosure risk; the follow-up review was
completed locally instead.

The 2026-10-26 per-bot acknowledgement update adds default-off persistence, owner
API validation, bot separation and restart/legacy-selection regressions to the
integration checks. Six focused settings tests pass, including both acknowledged
and blocked Sandbox rendering; formatting, lint and types pass for the update.
Full validation passed 214 tests with zero failures or skips, including real
Docker/OrbStack. The added blocked-state rendering case passed separately in the
focused run.
