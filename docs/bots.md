# Bots and personality

A bot is a persistent assistant identity inside one Raphie runtime. Each bot has
its own sessions, model connections and default model, memory configuration,
attachment store and reserved workspace directory. A session belongs to its bot's
store; it cannot be opened by addressing its UUID through another bot's API.

## Using bots in the web client

Use **Current bot** in the sidebar to switch assistants. The default selection is
Raphie. **Manage bot** opens **Settings → Bot**, where you can edit its name,
description and SOUL.md or create a **New bot**. A new bot is selected after
creation; add its provider under **Providers**, select a model under **Models**,
and configure its own backend/scope under **Memory**.

**Personality history** shows the latest saved revisions. Expand a revision to
read its previous name, description and SOUL.md. Copy older text into the editor
and save it to restore that personality as a new revision. Refresh after a stale
revision error; saves made while a turn is pending must wait for it to finish.

Named-bot links carry `?bot=<id>`, including session links and memory source links.
Switching bots replaces cached queries, observations, forms and draft keys;
switching back restores that bot's draft. Default-bot draft keys remain compatible
with existing browser data. Closing a view still does not cancel durable work.

**Backend** selects the shared runtime host; changing it returns to its default
bot. Providers, models and memory are scoped to the current bot. Theme, panel
layout and UI-plugin preferences remain browser preferences shared across bots;
they do not grant runtime tool capabilities.

## The default bot and existing installations

The first startup creates the stable `default` identity, initially named Raphie.
Subsequent starts reuse it. Its existing data stays in place: `gateway.sqlite`,
`settings.sqlite`, `memory.sqlite` and `files/` retain their paths under the data
directory. Session UUIDs, channel bindings, approvals, delivery identities and
saved memory scopes are preserved. No conversation or credential is copied into
another bot. Existing unprefixed HTTP routes continue to address the default bot.

## Identity and SOUL.md

A bot profile contains a name, description and owner-authored `SOUL.md` text.
Personality is trusted configuration stored in `bots.sqlite`, separate from
agent-editable memory and working files. It is injected into model instructions
when a turn is admitted; already admitted work keeps its captured instructions.
There is no tool for a bot to change its own profile or grant itself capabilities.
A conversational suggestion to change personality is ordinary text until the
owner applies it.

Profile saves require the current revision and are serialized with message
admission. A stale save or a save during that bot's pending turns returns 409.
Other bots can keep working. Every saved revision is retained; the history API
returns the latest 50. To undo a change, save the older text as a new revision.
Names are display labels; stable IDs identify bots even after renaming.

Do not put credentials in SOUL.md: the owner can read personality and its history,
and the configured model receives the active personality as instructions.
Provider and memory keys continue to use encrypted Settings storage and the OS
credential store. Personality text cannot grant permissions or change ownership.

## Runtime and persistence boundary

`BotHost` owns the registry and composes one Gateway/Pi harness, actor authority,
model registry, Settings and Memory service per bot in the same process. New bots
use `bots/<runtime-issued-id>/` under the data directory, containing separate
SQLite stores and `files/`. Each has a `workspace/` directory reserved for future
execution; the default bot's reserved directory is `<data>/workspace/`.

New bots start with built-in memory enabled and no model credentials or connected
MCP tools. Configure their own provider before sending messages. Default model
choices and session-specific model selection use the existing Settings behavior
within that bot. A credential change in one bot never republishes another bot's
model connections.

Local memory lives in separate stores. Memory requests for a named bot use the
host-derived scope `bot_<id>_<configured-scope>`, including Hindsight tags. The
default bot keeps its existing configured scope for compatibility. External
providers must honor their scope filters; a bot is not an external provider user
account, and independently supplied provider credentials can have broader access.

The host reopens persisted bots at startup so their durable work can recover.
Each harness owns its store; do not run another process against the same data
directory. A failure opening a persisted bot fails startup rather than silently
hiding it. Failed creation can leave an unused private directory or OS key; it
does not publish a partially initialized bot. No delete operation is provided.

## HTTP interface

All routes retain the existing loopback Host/Origin and client-marker checks.
Bot management is an owner/client operation, not an agent tool.

- `GET /api/bots`: profiles for owner management.
- `POST /api/bots`: create from `{ name, description, soul }`; the runtime issues
  the ID. No caller-selected ID or filesystem path is accepted.
- `GET /api/bots/:id/profile`: current profile.
- `POST /api/bots/:id/profile`: save `{ name, description, soul, revision }`.
- `GET /api/bots/:id/history`: latest 50 profile revisions, newest first.
- `GET /api/bots/:id/soul.md`: download the active personality as plain text.

Bot runtime routes use `/api/bots/:id/` followed by the existing API suffix. For
example, `/api/bots/:id/sessions`, `/settings`, `/memory`, `/files/:fileId` and
`/sessions/:sessionId/events` all operate against that bot's container. The same
prefix with `default` aliases the existing default-bot API. Public session UUIDs
are scoped by their containing bot; internal numeric Pi IDs can repeat in
independent stores. Cross-bot actor contexts are rejected even inside the process.

## Delivered limits and next steps

This is logical ownership separation, not OS or VM isolation. The host, owner UI
and process account remain trusted and can manage all bots. Local HTTP protection
is not bot-token authentication or remote-client authentication. No untrusted
sandbox code is executed in this slice.

The existing environment-configured Discord connection and MCP server still
belong to the default bot. Named bots do not inherit them. Named-bot channel and
MCP connection management remains future work. Operational OTLP export and
Diagnostics remain configured for the default bot; named-bot Diagnostics returns
an empty trace read model rather than another bot's traces.

Workspace shell execution, checkpointing, executor fencing, VM leases,
resource/concurrency budgets, bot deletion, cross-bot sharing, and independently
managed background tasks remain planned. Resident bot harnesses are opened at
startup; this change does not establish capacity for 100 active agents or VMs.

## Verification

`packages/runtime/test/bots.test.ts` exercises the real HTTP and Pi paths with
deterministic models and temporary stores. It covers default-data preservation,
separate sessions, streams, credentials, memory and attachments, cross-bot actor
and approval rejection, personality injection, optimistic revisions, pending-turn
locking, restart recovery and external memory scopes. Run it with `bun test
packages/runtime/test/bots.test.ts`; full validation remains `bun run validate`.
