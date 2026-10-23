---
status: accepted
---

# Bot-owned workspaces and temporary compute

Decision accepted 2026-10-23; implementation remains planned. One self-hosted
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

The current runtime has no BotId ownership model or bot workspace executor.
This decision changes the target architecture, not current product behavior.
