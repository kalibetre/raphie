# Bots and personality

A bot is a persistent assistant identity inside one Raphie runtime. Each bot has
its own sessions, model connections and default model, memory configuration,
attachment store and durable virtual workspace. A session belongs to its bot's
store; it cannot be opened by addressing its UUID through another bot's API.

## Using bots in the web client

Choose an assistant from the bot roster. Raphie is the default bot. Clicking the
bot’s name in the title bar opens **Profile**, which combines its name,
description, color and SOUL.md personality in one editor with one Save/Discard
bar. Revision history is available below the personality editor. Existing
Personality links open this same combined page.

Choose one of eight color presets, use the custom color picker, or select
**Automatic**. Explicit colors are saved with the bot in `bots.sqlite`, appear in
revision history and follow it across browsers. Automatic colors are allocated
in creation order, avoiding colors used by earlier bots until the palette is
full; beyond eight bots, colors are reused evenly. Explicit choices may share a
color. A bot's blob shape and gaze still derive from its stable ID.

**New bot** in the sidebar (the plus icon on mobile) creates an assistant and
opens its own provider setup. Add its provider
under **Providers**, choose a default under **Models**, and configure its memory
backend/scope under **Memory**.

The title bar contains the current conversation title and an icon-only **New
conversation** action. The right panel opens from the panel icon and starts with a **Conversations** tab: a searchable
list with filters for new replies and approval requests. On mobile it opens as a
sheet and closes when you select a conversation. Switching assistants
resumes their last opened conversation in this browser when available.

A grouped card below the title bar surfaces unread replies and approval requests
in other conversations. It shows three rows with a link to open the Conversations
panel for more.
Collapse it to focus; mobile starts collapsed unless a preference was saved.
Incoming replies update the count without expanding it. Dismissing a row only
hides the notice until a newer reply or approval state; it does not mark it read.
Read cursors are browser-local, scoped by backend, bot and session. A completed
reply is marked read when its conversation is visible and scrolled to the bottom.
Historical replies with no saved cursor count as unread in this browser.

The selected bot’s session summaries use the existing live stream. Other bot
badges poll their latest 100 sessions every 15 seconds while this browser is
active; the roster refreshes every 30 seconds. No stream is opened per bot or
background conversation. The Conversations tab retains pagination for older
conversations.

**Revision history** shows the latest saved profiles. Expand a revision to read
its previous name, description and SOUL.md. Copy older text into the editor and
save it to restore that personality as a new revision. Refresh after a stale
revision error; saves made while a turn is pending must wait for it to finish.

**Sandbox** in each bot’s settings shows its active execution provider, capabilities,
usage and fixed just-bash limits. It also saves provider, idle minutes (default 10,
range 1–1440) and optional disk quota in MiB (empty means no limit, the default).
Only just-bash is available; container is disabled with its unimplemented reason
and API saves requesting it return 409. Idle minutes and quota apply only to the
future container provider; no container execution or enforcement is delivered.

**Workspace** browses committed files with folder navigation and
individual downloads. Files are shared across that bot’s conversations; links
are labeled and not followed. See [workspace behavior](bot-workspaces.md).

**Activity** in each bot’s settings shows its latest 100 journal events across
conversations, refreshes every five seconds, and supports filtering and JSON
export. Activity requests use the selected bot’s backend scope.

Profile, provider, memory and sandbox editors block navigation with unsaved
changes; save or discard before leaving them.

Named-bot links carry `?bot=<id>`, including session links and memory source links.
Switching bots replaces cached queries, observations, forms and draft keys;
switching back restores that bot's draft. Default-bot draft keys remain compatible
with existing browser data. Closing a view still does not cancel durable work.

**Settings → App → Backend connection** selects the shared runtime host; changing it returns to its default
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
SQLite stores and `files/`. Each has a host-owned `workspace/checkpoint.sqlite`
containing files and separate revisioned sandbox settings; the default bot uses
`<data>/workspace/checkpoint.sqlite`. Files are interpreted in virtual `/workspace`,
not mounted from the host. See [workspace execution](bot-workspaces.md).

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

Sandbox settings use `GET /api/workspace` and `POST /api/workspace/settings`,
with the same named-bot prefix. Saves require the current settings revision,
serialize with admission, and return 409 for stale revisions or pending turns.
Settings are owner configuration; model tools cannot choose another bot or edit
these settings. See [sandbox settings](bot-workspaces.md#per-bot-sandbox-settings-native-sandbox-slice-1).

## Delivered limits and next steps

This is logical ownership separation, not OS or VM isolation. The host, owner UI
and process account remain trusted and can manage all bots. Local HTTP protection
is not bot-token authentication or remote-client authentication. Supported
shell-like commands run in a bounded just-bash worker over a virtual
filesystem. No native/VM execution or host filesystem mounts are provided.

Channels are configured per bot in Settings. Discord is the first supported channel; its token is encrypted using the runtime host’s OS credential store. Configure allowed Discord user IDs; an empty list denies all access. Only the initiating Discord user can approve or reject an action in Discord; the owner can also decide in the web UI. Existing pending requests without a recorded user, and tool approvals where queued turns make the initiator ambiguous, can only be decided in the web UI. An optional channel ID restricts the bot to that channel and its threads; otherwise allowed users can DM the bot or mention it in servers. Existing Discord environment variables are ignored: configure the default bot in the UI using the same application ID to retain existing bindings. Legacy records previously assigned `legacy-discord` cannot be automatically matched to an application ID. Each bot manages
its own MCP servers and recurring prompt jobs in Settings; see
[bot automation](bot-automation.md). Operational OTLP export and
Diagnostics remain configured for the default bot; named-bot Diagnostics returns
an empty trace read model rather than another bot's traces.

Workspace shell interpretation, checkpointing, executor fencing and lightweight
resource/concurrency bounds are delivered. VM leases, model-generation concurrency
policy, bot deletion, cross-bot sharing, and independently managed arbitrary
background tasks remain planned. Resident bot harnesses are opened at
startup; this change does not establish capacity for 100 active agents or VMs.

## Verification

`packages/runtime/test/bots.test.ts` exercises the real HTTP and Pi paths with
deterministic models and temporary stores. It covers default-data preservation,
separate sessions, streams, credentials, memory and attachments, cross-bot actor
and approval rejection, personality injection, optimistic revisions, pending-turn
locking, restart recovery and external memory scopes. Run it with `bun test
packages/runtime/test/bots.test.ts`; full validation remains `bun run validate`.

## App data continuity across checkouts

With `DATA_DIRECTORY` unset, runtime bootstrap uses the main Git checkout's
`.data` even when launched from a linked worktree. A packaged installation without
Git uses its installation directory. Explicit `DATA_DIRECTORY` values keep their
existing meaning: absolute paths stay absolute; relative paths resolve against
the running checkout. Fixture launchers pass isolated directories directly and
never participate in default discovery.

If a linked checkout already contains `.data`, startup stops before opening stores
and asks for an explicit `DATA_DIRECTORY` choice. It never copies, merges, deletes
or resets either directory. To keep that checkout's data, set `DATA_DIRECTORY=.data`;
to use the original installation, set its absolute data path. Stop the runtime
using that directory before starting another. Do not test new code against live
databases. Back up SQLite with its backup API while live, or stop the runtime
before copying the complete directory, and retain credential-store keys.

New runtime bootstrap claims `runtime-owner.sqlite` before opening product stores.
A live owner makes another launch fail; a dead owner can be reclaimed after a
crash. Permission errors and reused process IDs fail closed. Older releases do
not participate in this check: stop them before starting an upgrade. Never run
two Gateways against the same data directory, including with embedding/test APIs.

A persistent `workspace-identity.json` identifies the app data directory across
restarts and upgrades. Keep it in backups. The web view displays the backend URL
and short identity; expand it or open Backend connection settings for the complete
ID and data path. Older runtimes show “identity unavailable”; this never means
their data was deleted. Switching backends displays a different server's data;
it does not transfer conversations or settings. Explicit development/fixture
backends remain separate, and the browser fixture reports “Test fixture”.
Check the address and data path when history appears
missing before creating another workspace.
