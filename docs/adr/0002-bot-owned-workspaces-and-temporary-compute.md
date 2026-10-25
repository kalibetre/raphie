---
status: accepted
---

# Bot-owned workspaces and temporary compute

Decision accepted 2026-10-23; bot ownership and personality are now implemented. One self-hosted
runtime may host multiple Raphie bots. A bot is the ownership boundary for its
configuration, sessions, memory scope, workspace and permitted tools; it is not
a separate runtime process or a VM. Each bot starts with one default persistent
workspace and may have multiple sessions using it. This preserves continuity
across conversations without reserving compute for every idle bot.

The runtime derives a durable BotId and workspace from authorized session or
channel ownership, never from model-selected tool arguments. Authorize session
reads, observations, approvals, memory access and file operations against that
ownership. Existing owner authorization still applies; bots do not introduce a
new person/account system. A channel binding must resolve the bot as well as its
session. Shared infrastructure and credential storage may serve several bots,
but credentials and capabilities are only resolved for the authorized bot.
Cross-bot file or memory sharing requires an explicit authorized operation.

Serialize execution within each workspace, including across its sessions and
execution tiers. Different workspaces can execute concurrently. The workspace
survives sandbox shutdown or replacement; just-bash is the initial execution tier,
with temporary VM leases for native capabilities later. Files and explicit
artifacts cross tiers through checkpoints and transfer. Processes and RAM do not
implicitly migrate. Bound model generation, lightweight execution and VM leases
with separate runtime concurrency budgets.

Recovery must preserve workspace ordering and prevent an old executor from
writing after replacement; VM leases require fencing. Interrupted work with an
unknown external outcome remains uncertain rather than automatically replaying.
Logical bot/workspace separation is not a claim of OS-level security isolation:
choose process or VM boundaries according to executable capabilities and trust.

## Delivery sequence

1. Introduce bot ownership and a default bot for existing data. Preserve public
   session IDs, history, approvals, channel bindings, delivery identities and
   existing memory. Map the current saved memory configuration and scope to the
   default bot without silently copying, relabeling or exposing external data.
2. Add a default workspace per bot, bounded lightweight execution, persistent
   checkpoints, serialization and isolation/recovery acceptance tests.
3. Add native capability requests, explicit artifact transfer and fenced VM leases.

## First implementation

`BotHost` owns a persistent registry with the stable default identity and generated
IDs for named bots. It composes an independent Gateway/Pi harness, actor authority,
model registry, Settings, Memory and attachment store per bot inside the same
process. This uses existing recovery/authorization paths rather than introducing
bot filters throughout every legacy query and transaction. Existing default data
stays in place; named bots use private subdirectories. No second executor owns
the same durable store.

Profiles include name, description and SOUL.md. Owner saves use optimistic
revisions and the same admission gate as messages; active turns block edits.
The host supplies personality when admitting the next turn, and model tools cannot
write the profile. Per-bot MCP configuration and recurring jobs are delivered;
Discord still uses the default bot’s host configuration. See
[the implementation guide](../bots.md).

## Lightweight workspace delivery (2026-10-24)

Each Gateway now owns a persistent virtual `/workspace`. `workspace_exec` is
closed over that bot’s store and derives session identity from the admitted tool
context. just-bash runs in a disposable worker with no host filesystem mounts,
inherited environment or network/native execution capabilities. The host serializes
executions, applies resource/concurrency limits, and atomically commits a checkpoint
plus retry receipt in `workspace/checkpoint.sqlite`. Reopening increments a
persistent generation so replaced executors cannot overwrite new state. Pi and
process-crash tests establish shared files, recovery, fencing and isolation.

The initial policy commits files only on a zero shell exit and rolls back failed
or interrupted executions. Shell state and scratch files do not persist. Receipts
are bounded and never silently evicted. This supplies logical separation, not an
OS/VM boundary or an OS memory quota. VM leases, native capability escalation,
transfer and separate model-generation concurrency policy remain future work. See
[delivered behavior and limits](../bot-workspaces.md).
