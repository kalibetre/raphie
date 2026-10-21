# Headless Raphie: target architecture

[Explore the interactive HTML field guide](architecture.html) for a visual summary
of this design. Open the file directly; no server or external assets are needed.

Design dated 2026-10-21. The principles in [ADR 0001](adr/0001-headless-runtime-and-capability-specific-adapters.md)
are accepted. All four migration slices now have working implementations and acceptance coverage. This document records the design; [headless-interface.md](headless-interface.md) describes the delivered names, routes, limits and migration behavior. Desktop, CLI, Telegram and session linking remain future work.

## Product scope

The runtime can operate with the web application stopped. Web, desktop, and CLI
are clients; Discord and future Telegram integrations are messaging channels.
All share conversation and approval behavior, with presentation appropriate to
each interface. A platform does not need every operation merely because another
client exposes it.

| Capability                                           | Web / desktop                   | CLI                          | Discord / future Telegram                                      |
| ---------------------------------------------------- | ------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| Send messages, receive replies                       | Yes                             | Yes                          | Yes                                                            |
| Request and decide approvals                         | Yes                             | Yes                          | Yes, with explicit controls                                    |
| Open sessions / read history                         | Rich navigation                 | Commands                     | Native conversation history; extra navigation only when useful |
| Live execution feedback                              | Streaming and structured status | Watch output                 | Optional concise feedback, not a diagnostic feed               |
| Activity, usage, diagnostic inspection               | Inspector                       | Optional inspection commands | Not required                                                   |
| Theme, panel layout, UI plugins                      | Client-specific                 | Terminal-specific            | Not applicable                                                 |
| Continue a web session from a messaging conversation | Deferred                        | —                            | Deferred                                                       |

The columns describe intended capabilities, not currently implemented desktop,
CLI, or Telegram products. Session linking is a roadmap item. In the first
migration, an authorized Discord conversation retains its existing session;
there is no new link command, history import, fan-out, or account-linking flow.

## Runtime ownership and deployment

Keep one self-hosted runtime process with internal domain modules. It owns the
Pi Durable harness, SQLite, model connections, tool execution, authorization,
attachment storage, and durable delivery records. Hono/Bun hosts its network
interface. No additional message broker, microservices, or hosted control plane
are needed for this redesign.

Clients do not instantiate the harness or access SQLite. A desktop client can
connect to an existing runtime. A future local desktop distribution may start a
runtime and manage its lifecycle, but must attach to an existing owner of the
data directory instead of opening a second executor on the same store. A window
closing disconnects its viewer; whether the application explicitly stops a
runtime it launched is a separate lifecycle operation.

Runtime-owned work continues when all viewers disconnect. Channel adapters can
initially live in the same process, invoking application operations directly.
HTTP clients use the same operations through a network adapter. Moving a channel
adapter out of process later must not move execution ownership into that adapter.

## Domain responsibilities

| Module             | Owns                                                                                                       | Does not own                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Conversations      | Session identity, turn admission/order, message history, observed run state                                | Discord thread IDs, provider formatting, UI layout    |
| Approvals          | Exact proposed action, deadline, decision, execution disposition                                           | Button rendering, chat phrase interpretation          |
| Channels           | Authorized external conversation bindings, inbound deduplication scope, reply destinations, delivery state | Model loop, tool execution policy                     |
| Attachments        | Stored bytes, ownership/access, limits, references                                                         | Platform upload UI or provider-specific file IDs      |
| Inspection         | Activity/usage/diagnostic read models and exports                                                          | Agent scheduling or mandatory channel commands        |
| Application access | Trusted actor context and operation authorization                                                          | Accepting arbitrary caller-supplied identity as proof |
| Clients            | Presentation, drafts, layout, navigation, UI contributions                                                 | Authoritative session history or approval state       |

These are module responsibilities within a modular monolith, not a declaration
that each folder is already an independently isolated bounded context. Identity
continues to support the existing single-owner product; organizations, teams,
roles, and a general account system are outside this slice.

Business policies live in domain modules. Application operations orchestrate
policies through persistence/tool ports. Pi Durable transactions and workflows
remain adapters behind those ports; transport handlers do not manage harness
transactions. Bootstrap wires the implementation and owns process lifecycle.

## Application interface

Expose a small interface divided by purpose. Adapters select the operations
they need; there is no generic command bus or adapter-specific copy of the
conversation/approval rules.

| Interface          | Operations                                                            | Contract                                                                                |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Session commands   | Create a session; submit a message to a session                       | Public UUIDs, stable request ID, authorized actor, accepted turn receipt                |
| Channel ingress    | Accept an authenticated external message                              | Resolve/create the conversation binding and admit one turn atomically                   |
| Approval commands  | Decide an identified approval                                         | Explicit approved/rejected decision, actor/destination authorization, original deadline |
| Session queries    | List sessions; read a session, transcript page, and pending approvals | Authorized, bounded read models; no SDK IDs or task internals                           |
| Observation        | Subscribe to authorized session state and text/status changes         | Viewer lifetime only; disconnect never cancels execution                                |
| Inspection queries | Read/export bounded activity and usage                                | Available to inspection-capable clients; not mandatory messaging commands               |

A receipt acknowledges durable admission, not completion or successful tool
execution. Reusing a request ID with the same content returns the same receipt;
reusing it with different content returns a conflict. An unrecognized session
returns not-found rather than silently opening a replacement.

Use UUID session identifiers at the application and wire interfaces. Numeric Pi
conversation IDs remain inside its adapter. `@raphie/contracts` describes wire
commands, receipts, structured errors, and read/event DTOs; domain policies must
not be defined by a transport schema. Add a small client SDK when there are two
HTTP callers; it centralizes authentication, error decoding, and subscriptions,
not domain decisions.

Client-origin and channel-origin admission are deliberately different seams.
A Discord message cannot choose an arbitrary session ID; channel ingress resolves
its own authorized binding. This preserves today's thread isolation while
leaving room for a future explicit link operation.

There is no implication that every listed query is already efficient internally.
Bounded contracts let us optimize Pi/SQLite reads behind the interface without
changing each caller.

## Identity, authorization, and destinations

An adapter authenticates the caller and supplies trusted actor context through
an internal seam. Discord identity includes the configured connection and user,
guild/channel/thread scope. The application verifies owner access and binding
scope. HTTP derives actor context from its access mechanism, never from an
`actor: "owner"` field sent in a JSON body.

The current loopback Host/Origin checks and `x-raphie-client: web` marker are
browser defenses, not remote-client authentication. Preserve them during the
migration. Before allowing remote desktop/CLI access, add authenticated runtime
access and authorize every query/command/subscription. Do not expose the current
loopback interface unchanged on a public network. Credentials stay in private
runtime configuration, not transcripts or shared DTOs.

A channel binding records the session, owner, connection/provider, and external
conversation address. The uniqueness key includes connection and external
conversation scope, not a bare thread or message ID. Initially each external
conversation resolves to one existing-or-new session.

Every admitted turn records its origin independently of the session's identity.
Channel-origin turns have an authorized reply destination. Client-origin turns
are observed by authorized client subscriptions. A later channel binding must
not redirect an already admitted reply or broadcast history automatically.

## Durable channel delivery

The domain records that a reply or approval request is ready, with its intended
destination. Channel presentation creates a transport-specific delivery plan:
text chunks, cards, attachments, and edits. Persist that plan before sending;
claim and settle each outbound operation independently. A long reply cannot be
sent as several untracked network calls under one completed delivery record.

The application owns pending/sending/sent/uncertain transitions. Adapters render
and perform network calls; they do not mutate another domain's state or claim
work for unrelated adapters. A delivery worker receives only its scoped outbox
operations. Preserve returned platform message IDs for later edits.

Remote delivery is not exactly-once. When a process dies after claiming a send,
the result can be uncertain. Use platform idempotency where available; otherwise
require inspection/reconciliation before resending an uncertain operation. A
successful delivery also does not establish that an approved tool succeeded.

Approval requests keep their immutable action identity, exact arguments, and
deadline across renderers. Full arguments must remain available when a platform
card is too small. Unsupported interactive controls need an explicit authorized
decision mechanism; ordinary conversational text must not accidentally approve
an action. Duplicate/competing decisions settle against the same persisted record.

## Observations and inspection

Distinguish delivery to a messaging destination from observation by a client.
Do not create an outbox send for every text delta. Web/desktop/CLI can subscribe
to observed state; a messaging adapter may send a final reply and optionally
update a concise status indication within that provider's limits.

Return structured observed phases such as waiting-for-model, responding,
awaiting-approval, and running-tool. Client labels are presentation. Do not claim
to expose private model reasoning or infer invisible execution from elapsed time.

Replace whole-workspace snapshot polling incrementally with session summaries,
paged transcripts, targeted inspection queries, and session-scoped observations.
Use the existing durable journal and model observation facilities; do not add an
independent event-sourced write model. A reconnect receives authoritative state;
if resumable cursors are introduced, specify retention and a snapshot-reset path
when the cursor is no longer available. Slow viewers never block durable execution.

Inspection data and subscriptions are authorized to the same owner/session scope.
The adapter's presentation capabilities do not grant additional access. Redact
before persistence and transport, as in the current implementation.

## Delivered implementation and remaining limits

Shared commands accept runtime-issued actor context. New client sends and focused
reads use UUIDs; the numeric admission endpoint is retained only for compatibility.
Bindings and per-turn origins replace session-owned Discord routes. Discord
chunking lives in its renderer, with one connection-scoped worker and persisted
plans replacing the three adapter pumps. Pure run/tool/usage projections are
shared without React dependencies. Web uses focused queries and observations.

The legacy source enum still names web and Discord for stored-event compatibility;
channel identity is a separate structured reply destination. Local HTTP access
remains single-owner and loopback-only. No remote authentication, full CLI/desktop
application, Telegram integration or session-link command has been added. Retained
Pi documents are still scanned internally; response pagination is not an indexed
storage optimization. See the implementation record for measured limits.

## Migration invariants

Preserve public session UUIDs, turn/approval IDs, request deduplication identities,
absolute approval deadlines, existing history, completed effects, and uncertain
execution/delivery state. No session data is reset or merged. Backfill bindings
from existing Discord associations; client sessions remain unbound.

Version durable documents deliberately. Migrate existing pending deliveries with
their original identity/destination, or drain them through a compatibility reader;
never enqueue copies as part of a backfill. Preserve old request-key lookup while
new scoped keys are introduced so a retried old message is not admitted twice.

Keep existing endpoints temporarily as adapters to the new operations while the
web client moves. Characterization tests cover both interfaces until callers have
migrated. The selected implementation slices and acceptance cases are in
[roadmap.md](roadmap.md).
