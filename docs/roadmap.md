# Headless architecture roadmap

Each slice must leave the existing prototype usable. The
[target design](headless-runtime.md) describes the destination; this roadmap does
not mark planned capabilities as implemented. Keep Bun, Hono, Pi Durable, SQLite,
and the existing self-hosted deployment.

## Implementation progress

- Shared UUID message submission and tool approval decisions now run through
  `application/sessions`. HTTP and Discord establish runtime-issued actor contexts;
  fabricated/deserialized contexts are rejected. The compatibility numeric endpoint
  retains old admission fingerprints.
- The real Discord SDK fixture now admits a model turn, receives its proposal,
  accepts an owner decision through the shared client operation, ignores a stale
  Discord click, and delivers the completed reply without starting a web process.
- Verification: 40 tests pass; domain checks, TypeScript 7, Oxlint, Oxfmt and
  production build pass. No live database or service was restarted for this slice.
- Channel associations now live in durable `ChannelBindings`, scoped by owner,
  Discord application and external conversation. Startup backfills legacy fields
  transactionally and removes them from the session record. Each new turn freezes
  its reply destination; web turns have no channel destination. Tool proposals use
  their originating turn. Existing source/event keys remain valid, with route
  checks before returning duplicate receipts. Migration and delayed-origin tests
  pass (42 tests total).
- Focused reads, delivery extraction and web observation migration remain in the
  following slices.

## 1. Application operations and trusted actor context

Introduce conversation submission, approval decisions, and session reads behind
application interfaces using public UUID session identifiers. Keep Pi numeric IDs
inside the persistence adapter. Web and Discord invoke the same authorization and
admission operations; adapters establish identity rather than accepting a caller's
claimed owner string as proof. Existing endpoints remain compatibility adapters.

Verify web and Discord admission/decisions against the same operation-level suite:
unknown sessions, duplicate IDs, conflicting retries, unauthorized actors,
concurrent approval decisions, expiry, and restart recovery. Existing HTTP,
Discord SDK, and durable crash tests remain characterization coverage.

Acceptance: an integration test runs runtime plus Discord fixture, without any
web process, and completes a message → approval → exact tool execution → reply.
A web decision can still settle a Discord-origin approval; a subsequent stale
Discord click cannot execute it again. This does not link or continue sessions.

## 2. Channel bindings and stable origin routing

Move Discord associations out of the session model into channel bindings. Resolve
an inbound Discord conversation to its binding and session inside durable admission.
Persist the reply destination on the admitted turn, rather than deriving it from
a mutable session field at completion. Keep today's owner/channel/thread policy.

Backfill current associations without changing session UUIDs or admitting new
turns. Preserve old deduplication keys during transition. Initially there is no
operation for attaching a second channel or choosing a web session from Discord.

Acceptance: a restart or duplicate platform event reuses the original binding,
turn, and destination. Another thread cannot access its history or decide its
approval. Existing client sessions remain unbound. Delayed replies never acquire
a new destination due to unrelated configuration/binding changes.

## 3. Durable delivery module and Discord adapter

Replace the broad delivery claim/settle surface exposed to Discord with a scoped
delivery worker. Conversation/approval operations record delivery intent without
knowing Discord message limits. The channel renderer prepares persisted chunks,
cards, files, and edits; each network operation has a stable claim and disposition.

Migrate or drain existing pending deliveries under original IDs. Do not replace
Pi Durable with an independent queue system. Keep all unknown action/delivery
outcomes uncertain until explicitly reconciled.

Acceptance: kill the worker after the first chunk of a multi-part reply. Recovery
must not silently duplicate that chunk or lose the remaining plan. Simulate failed
sends, uncertain results, card edits, competing decisions, and adapter disconnects.
Completed tool actions are never rerun to repair a notification failure.

## 4. Client query and observation interface

Separate session summaries, paged history, pending approvals, observations, and
optional inspection queries from the whole-workspace snapshot. Move reusable
run-state and usage projections out of React-dependent code. Web uses these
operations through the HTTP adapter; keep compatibility reads until migration ends.

Define structured phases/errors and bounded pagination. Reconnect starts from
authoritative state; introduce resumable event cursors only with retention/reset
semantics. Avoid promising an efficient data path until measured against the
actual Pi storage adapter.

Acceptance: a small HTTP client fixture lists/reads a session, submits a message,
observes output, and decides an approval without starting the web application.
Disconnect/reconnect and slow readers do not interrupt work or replay a command.
Load-test concurrent viewers and sessions to establish a baseline; this redesign
does not itself establish capacity for 100 active agents or sandboxes.

Activity, usage, and diagnostic inspection stay available to capable clients.
There is no Discord/Telegram inspection-command requirement.

## Later client and channel work

- **CLI:** use the client interface for session selection, send/watch, approvals,
  and optional structured inspection output. No second executor or direct DB access.
- **Desktop:** connect to an existing runtime first. Local runtime packaging,
  discovery, authenticated access, and single-owner lifecycle can follow. Closing
  a view must not accidentally cancel execution.
- **Remote clients:** add authenticated access before relaxing loopback binding;
  retain browser origin protections and authorize subscriptions and reads too.
- **Telegram:** add an adapter with its own address/identity verification and
  rendering once the Discord module proves the shared interface. Unsupported
  capabilities should be explicit rather than silently dropped.
- **Cross-channel continuation:** explicit ownership-checked link/unlink and
  destination selection, with history-disclosure policy. No implicit broadcasting,
  automatic identity matching, or copying transcripts into a new session.

General chat attachments, cancellation, model/tool configuration commands,
automations, and other capabilities that the runtime does not currently expose
need their own contracts and acceptance criteria. This architecture does not
make them available merely by adding another client. Private runtime configuration
continues to be managed through Varlock, not conversational credential prompts.
