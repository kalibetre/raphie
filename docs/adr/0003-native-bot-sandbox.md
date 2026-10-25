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

## Network defaults that stay on

Open internet does not mean open host. By default the sandbox cannot reach
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

1. Provider interface and settings: provider, idle minutes and optional quota;
   existing bots stay on just-bash.
2. Container `ExecutionEnv` with the single-folder mount, lease and fencing,
   host-reach denial and resource bounds. Prove cross-bot isolation, shared
   files across sessions, idle stop and restart, and interrupted-command
   recovery with real `git` against a local test repository.
3. Pi `CodingTools` installed for container bots; Sandbox and Workspace files
   pages read through the environment.
4. Egress proxy with per-host credential grants, TLS termination, audit log and
   the optional write-approval toggle. Prove that no credential appears in the
   container environment, filesystem or process list, and that a non-granted
   host receives none.
5. Image contents, including `git`, `gh`, `rg` and common runtimes, and a
   documented way to extend them.

## Open points

- Docker versus Podman as the first supported runtime, and how Raphie finds it
  locally and on a server.
- Whether the image ships `gh` and package managers, or the bot may install
  tools into its own folder.
- Where the CA and proxy run when Raphie itself runs in a container.
- The default idle period and the host free-space floor.
