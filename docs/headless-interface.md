# Delivered headless interface

Implemented 2026-10-21, in four migration commits followed by an access/recovery
review. The [HTML guide](architecture.html) shows the modules and request flows.
The [design](headless-runtime.md) records intent; this file records actual behavior.

## Run without the web application

`bun run dev:runtime` starts the single durable owner on loopback port 4316. It
loads private configuration through Varlock and starts Discord when enabled.
`bun run start:web` starts only the built client host; it owns no SQLite database
or model execution. `bun run start` starts both. No additional broker or service
was introduced. Bun, Hono, TypeScript 7, Oxfmt and Oxlint remain the stack.

HTTP retains loopback Host/Origin and browser client-marker checks. The marker is
not remote authentication. Trusted adapters establish runtime-local actor contexts;
application operations reject unissued/deserialized contexts. Discord first checks
the configured owner, guild, parent channel and optional thread. It never accepts
an arbitrary session ID from message text. Remote authenticated access is later work.

## Client routes

All routes below are prefixed `/api`. The web host proxies them to the runtime.

| Method | Route                                                | Result                                                                         |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/sessions/messages`                                 | `{ id, sessionId }` durable admission receipt                                  |
| GET    | `/runtime`                                           | Model/MCP metadata and uncertain tool-notification IDs                         |
| GET    | `/sessions?limit=100&after=<session-uuid>`           | `{ items, next }` summaries                                                    |
| GET    | `/sessions/events`                                   | Authoritative first 100 summary observations over SSE                          |
| GET    | `/sessions/<uuid>`                                   | Session observation: recent turns, approvals, live text, activity, phase/error |
| GET    | `/sessions/<uuid>/history?before=<turn-id>&limit=50` | `{ items, next }`, ordered oldest-to-newest within each page                   |
| GET    | `/sessions/<uuid>/approvals`                         | Latest 100 approval views, including pending decisions                         |
| GET    | `/sessions/<uuid>/events`                            | Authoritative selected-session observations over SSE                           |
| POST   | `/tool-approvals/<id>`                               | Shared explicit approval decision                                              |
| GET    | `/inspection/activity?before=<event-id>&limit=100`   | Optional bounded diagnostic page                                               |

Submission JSON contains `text`, stable `eventId`, and optional `sessionId`.
Decision JSON contains `decision: "approved" | "rejected"`. Mutations require
`Content-Type: application/json` and `x-raphie-client: web`. Actor and destination
fields in JSON are never trusted. A receipt is admission, not completion.

New query conversation identifiers are public UUIDs, including the legacy-named
`conversationId` field in transcript/activity DTOs. Summary `id` and `sessionId`
are the same public UUID. Pi conversation/task IDs, admission fingerprints and
reply-route fields are excluded from these query DTOs. Exact approval arguments
and redacted activity payloads, including observed tool results, remain inspectable.

Count-based pages accept 1–100 items. Default history is 50 turns; a session
observation additionally includes its first pending turn if it fell outside that
window (at most 51). Session observations include the latest 200 retained session
activity events and latest 100 approval records. Full retained activity is
separately paged. These are count limits, not a guarantee of a fixed byte size.
The existing journal retains 5,000 events and truncates individual detail payloads.

Phases are `idle`, `queued`, `model`, `writing`, `tool`, `approval`, `failed`.
Observed phases describe available evidence, not private model reasoning.
Errors retain the compatibility `error` message with an additional stable `code`
for application failures. Unknown sessions are 404; conflicting admission retries
are 409. Settled approvals are immutable; expiry wins at its original deadline.

Each SSE connection starts with authoritative state and sends replacements when
it changes, with heartbeats while idle. No event-resumption cursor is promised.
An activity page anchor that has rolled out of retention returns 409 and asks for
a fresh read. Viewer abort/backpressure never cancels or resubmits a turn.

Web composes focused reads locally. It can load older messages, more session
summaries and earlier diagnostics. Reusable run/tool/usage projections live at
`@raphie/contracts/projections`, independent of React. Old `/chat`, `/chats`,
`/events`, numeric-link resolution and file experiment routes remain compatibility
interfaces. There is no new session-link, broadcast, cancellation or general chat
attachment operation. Desktop, CLI and Telegram applications remain unbuilt.

## Durable state and migration

Startup runs recovery/backfill transactionally before resuming Pi. Existing
session UUIDs, turns, request keys, approval identities, deadlines, completed
effects and notification IDs are preserved. Legacy session-owned Discord fields
become `raphie.channel-bindings` records scoped by owner/application/conversation.
Turns freeze their own destination; web turns have none. Later binding/config
changes cannot redirect an admitted reply. Old Discord event IDs retain their
source/event deduplication keys; returning a receipt also checks origin scope.

Replies and approval operations record intent. The Discord renderer persists a
`raphie.delivery-plans` record before any send, with stable per-operation IDs,
complete chunk/card/file/edit payloads, status and platform message IDs. Existing
pending intent IDs are drained directly, never copied into new intents. Each
worker is scoped to one Discord application; another connection cannot claim its
intents or remaining chunks. Claims interrupted during network I/O become
uncertain. Confirmed and uncertain chunks are not automatically repeated; later
pending chunks can still be delivered. Notification failure never repeats an
approved tool action. The file-copy experiment uses the same verified context and
checks the original connection/thread before a retry or approval decision.

Existing document kinds remain version 1 with additive fields and an explicit
backfill, plus the two new document kinds. Legacy routing fields are removed from
session records after backfill. An older executable is not a supported downgrade
reader of this layout: stop the runtime and restore its pre-migration backup only
if no new work needs preserving; otherwise make a forward recovery change. Never
open the same data directory with two harness owners.

## Verification and local rollout

`bun run validate` passes: formatting, domain dependency checks, native type-aware
lint, TypeScript 7, **48 tests**, and production build. Existing Vite large-chunk
advice remains a non-failing build warning. Tests use temporary databases and
mock models, without paid inference or external Discord traffic.

Acceptance covers the real Discord SDK ingress → model proposal → shared owner
decision → exact tool execution → reply, with no web process; stale decisions do
not repeat the action. A headless HTTP fixture covers submit/list/read/page/watch,
viewer disconnect/reconnect, competing decisions, exact arguments and retry
idempotence. Read tests deny foreign threads/connections and forged contexts.
SIGKILL tests preserve confirmed and uncertain first-chunk outcomes independently
from the rest of a multipart plan. Legacy state migration preserves identities.

Local rollout: the idle prototype had 1 session, 7 turns and no pending work.
SQLite backup `.data/backups/before-headless-20261021.sqlite` passed integrity.
After restarting the normal local runtime/web pair, all session and turn IDs
matched the saved metadata, SQLite integrity passed, and `/api/sessions` through
the web host returned 200. No model call or Proxmox VM change was made.

Reproduce the small baseline with `bun scripts/benchmark-client-queries.ts`:

| Local baseline, Bun 1.4.3 / macOS arm64             | Result      |
| --------------------------------------------------- | ----------- |
| Stored deterministic-model sessions                 | 100         |
| Concurrent SSE viewers left without reading updates | 25          |
| HTTP observation samples, batches of 25             | 100         |
| Latency p50 / p95                                   | 1 ms / 4 ms |
| Mean response bytes                                 | 2,499       |
| Follow-up completion while viewers were idle        | 12 ms       |
| Process RSS                                         | 83 MiB      |
| Real model calls / sandboxes                        | 0 / 0       |

This is a short local query baseline, not a soak test or proof of 100 active
agents/VMs. Pi document reads still scan retained state and observations still
poll at 150 ms; indexed reads, production-scale viewers and real sandbox/model
capacity need separate measurements. No new infrastructure dependency was added.

## Session model selection

`POST /api/sessions/messages` accepts an optional `model: { provider, modelId }`.
For a new session, omission uses the Settings default; an explicit choice is
saved with the first turn. The selected model participates in the admission
fingerprint, so retrying an event ID with a different explicit model is a conflict.

`POST /api/sessions/:id/model` changes an idle session's model without admitting
a message. It validates the connected provider and catalog and rejects active
sessions with 409. A session observation exposes the saved choice as
`session.model`. Sessions preserve their model through default changes and
restarts; legacy records are backfilled from their existing Pi agent model.
