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
- Discord now uses one scoped delivery worker. The renderer persists complete
  chunk/card/file/edit payloads before sending, and every operation stores its
  disposition and platform message ID. Existing intents retain their original IDs;
  new chat intents contain whole replies, with chunking confined to Discord.
  SIGKILL tests cover both confirmed and unknown first-chunk outcomes: recovery
  sends only the remaining chunks. Unknown chunks remain uncertain (44 tests).
- Focused client queries now provide summary pages, UUID session observations,
  50-turn history pages, approvals, runtime metadata and optional activity pages.
  Web reads these interfaces and offers older-history/list pagination; whole-state
  endpoints remain compatibility reads. Pure run/tool/usage projections live in
  the framework-free contracts package. Headless client/read-authorization tests
  and browser approval acceptance pass (46 tests total).
- Local baseline on 2026-10-21 (Bun 1.4.3, macOS arm64): 100 deterministic-model
  sessions, 25 SSE viewers and 100 queries measured p50 1 ms / p95 4 ms, average
  response 2,499 bytes, RSS 83 MiB; a follow-up completed in 12 ms while those
  viewers stopped reading. Run `bun scripts/benchmark-client-queries.ts` to repeat.
  This uses zero sandboxes and is not a model/sandbox capacity test. Pi document
  reads still scan retained state; bounded responses do not imply indexed storage.
- Final review added connection-scoped worker claims and verified-context file
  experiment operations, with thread/connection checks before retries and decisions.
  All 48 tests and the complete quality gate pass. The live local prototype was
  backed up and restarted: all 1 session / 7 turn IDs survived, SQLite integrity
  passed, and the new web query returned HTTP 200. No VM changes or model calls
  were needed. See [the implementation record](headless-interface.md).

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

Default model selection, OpenRouter key connections, local backend selection and
trace collection controls are delivered in Settings. Authenticated remote backend
connections and additional model providers remain future work.

General chat attachments, cancellation, conversational model/tool configuration commands,
automations, and other capabilities that the runtime does not currently expose
need their own contracts and acceptance criteria. This architecture does not
make them available merely by adding another client. Private runtime configuration
continues to be managed through Varlock, not conversational credential prompts.

## Next phase: lightweight execution, memory, and VM escalation

Direction recorded 2026-10-22. Durable lightweight execution and the first
configurable-memory slice are delivered. VM escalation and the full learning-memory
lifecycle remain planned.
Explore the execution, memory, and budget simulations in the
[HTML architecture guide](architecture.html#execution-memory).

Memory slice 1 adds **Settings → Memory**, built-in memory enabled by default and a Hindsight
connection. Built-in evidence uses SQLite FTS5, scoped provenance, event time,
corrections and logical forgetting; stable receipts prevent replay from restoring
a corrected or forgotten source. Reflection supplies evidence to the conversation
model rather than running a separate consolidation model. Hindsight supports
synchronous retain, scoped recall and provider reflection; source corrections and
deletion must currently be managed in Hindsight. API keys use the existing
OS-backed Settings cipher. Active turns block configuration changes; switching
never migrates data or falls back. Memory tools are not automatically replayed
when interrupted. Honcho, Markdown, named connection libraries, background local
consolidation and adapter relevance/cost evaluation remain subsequent slices.
The adapter is tested against a local server matching the documented Hindsight
API, not a live deployment. Forgetting current evidence does not erase chat
history, old tool outputs, backups or forensic storage remnants.

Start with **just-bash** for supported shell-like commands over a virtual
filesystem. Do not reserve a VM per conversation. Keep agent/task state and
workspace checkpoints outside compute; use an explicit execution port to request
native capabilities and lease a self-hosted VM only when needed. Runtime policy,
approval where required, and separate concurrency budgets govern escalation.
Files and explicit artifacts cross tiers; live processes and RAM do not
implicitly migrate. Credential-bearing integrations remain host-side tools.

Accepted ownership direction (2026-10-23): [ADR 0002](adr/0002-bot-owned-workspaces-and-temporary-compute.md).
One runtime may host many bots. Each bot owns its configuration, sessions, memory
scope and one default workspace; multiple sessions share that workspace.
Sandboxes are replaceable. Serialize execution per workspace and budget model
generation, lightweight execution and VM leases separately. Derive bot/workspace
identity from authorized context, never model-selected IDs. Cross-bot sharing is
explicit. The bot ownership and personality foundation is delivered through
separate per-bot stores and authorities, as described in [bots.md](bots.md).
Lightweight workspace execution now has separate queue/concurrency and resource
bounds. VM/native execution, model-generation concurrency policy and OS-level
containment remain planned.

Proposed slices:

0. **Bot ownership foundation — delivered:** a persistent default bot reuses
   existing stores and IDs. Named bots have isolated Gateways, authorities,
   model connections, Settings, Memory and attachments. Profiles provide name,
   description and owner-authored, revisioned SOUL.md. Integration tests cover
   cross-bot session/stream/file access, actor and approval rejection, separate
   credentials and memory, personality admission locking, and restart recovery.
   Per-bot MCP connection management and recurring prompts are delivered; see
   [bot automation](bot-automation.md). Per-bot Discord management remains subsequent work.
1. **One durable lightweight workspace per bot — delivered (2026-10-24):**
   `workspace_exec` uses pinned just-bash in disposable workers with only a virtual
   filesystem. Sessions share their bot’s files; executions serialize per bot.
   Host-owned SQLite checkpoints and execution receipts commit atomically, outside
   compute. Persistent generations fence replaced executors. Tests cover binary
   files, cross-bot separation, Pi recovery after SIGKILL, duplicate append
   prevention, rollback on failure, and resource/queue/concurrency bounds. There
   are no host-home/settings mounts, inherited credentials, network or native
   runtime capabilities. Five seconds, 32 KiB output, 8 MiB files, 1,024 entries,
   16 queued operations per bot and four concurrent lightweight workers are the
   initial limits. Bot Settings now exposes the active provider, capabilities,
   policy and usage under Sandbox, plus committed file browsing and downloads
   under Workspace. just-bash is the only currently available execution provider;
   owner-facing provider selection and policy editing remain future work.
   This is not OS/VM isolation or a capacity benchmark. See
   [workspace behavior and limits](bot-workspaces.md).

   The prerequisite continuity slice anchors unset data paths to the main checkout,
   refuses ambiguous separate worktree data, preserves explicit DATA_DIRECTORY
   and fixture isolation, and shows backend/data identity. Legacy default-bot MCP
   stays host-configured until explicit encrypted import, without merging saved
   connections. See [app data continuity](bots.md#app-data-continuity-across-checkouts)
   and [MCP upgrade semantics](bot-automation.md#mcp-tools).

2. **Configurable experience-based memory:** provide a runtime-owned Memory
   interface with adapters for **Raphie built-in memory, Hindsight, Honcho and
   Obsidian / Markdown vaults**, configured through **Settings → Memory**.
   Built-in memory is included without requiring an external memory service;
   the first slice uses SQLite evidence and FTS5 lexical retrieval, with
   broader indexing and consolidation choices still open. External
   providers are supported integration targets, not mandatory dependencies.
   Settings manages named connections, endpoint and protected credentials or a
   scoped vault path, provider namespace, capabilities and active backend.
   Each bot has its own active connection and host-derived memory scope.
   Translate source IDs and scope to provider-specific identities in adapters rather than leaking bank/peer/vault details into agent turns.

   Retain facts and confirmed experiences with provenance and event time;
   consolidate revisable observations; recall bounded relevant evidence; reflect
   with support and uncertainty. These are desired application behaviors, not
   an assertion that every provider has equivalent native methods. Report native,
   Raphie-provided and unsupported capabilities explicitly. Do not hide weaker
   semantics behind a success response. Tasks and reminders remain separate.

   A Markdown vault contains user-editable source notes. Index external edits,
   return file provenance, separate generated observations, constrain write paths
   and detect conflicts. Reflection/consolidation can be supplied by Raphie where
   configured, not claimed as a native Obsidian feature. Forgetting a derived
   memory must not silently delete an authored note.

   Switching backends preserves existing data and affects subsequent work after
   in-flight memory operations settle. No implicit migration, synchronization,
   dual writes or fallback on failure. Imports/exports and migration are explicit
   operations. Surface ingestion/consolidation lag and outages. Keep secrets in
   encrypted Settings storage, never browser read responses or sandbox files.

   Acceptance: implement built-in plus one external adapter against the same
   interface first, then Honcho and vault adapters in independent slices. Prove
   sourced cross-session recall after restart, deduplicated ingestion, isolation,
   evidence-linked reflection, temporal correction and forgetting of derivatives.
   Also verify Settings connection testing/activation, unsupported capabilities,
   safe switching, failure visibility and concurrent vault edits. Evaluate
   relevance, unsupported inference, latency and cost per adapter.

3. **On-demand VM execution:** capability request, policy check, exclusive lease,
   fenced recovery, explicit input/output transfer, idle cleanup and a concurrency
   budget. Prove a real repository test and bulk downloads before choosing the VM
   backend. Unknown external effects remain uncertain rather than automatically
   replaying after a lost VM. Kubernetes deployment is a target, not implemented.
4. **Durable follow-through:** commitments have assignee, deadline/timezone,
   source and open/completed state. A scheduler owns reminder timing, deduplicated
   admission and delivery; saving a memory alone does not schedule a reminder.
   Prove restart during the wait and no duplicate notification after recovery.
5. **Mixed-workload measurement:** benchmark light tasks and concurrent heavy
   jobs on the target host. Record startup/queue latency, task success, process-tree
   memory, CPU, storage growth and model cost separately. Choose limits from the
   evidence rather than from registered-agent counts.

Historical evidence: the 2026-10-17 Eve / just-bash POC reached 300 simulated
agents with mock models/integrations and no VMs, around 750 ms p95 tick latency
and 1.03 GiB process memory. It did not measure mixed-tier execution or production
memory retrieval. Separate microsandbox 0.5.10 tests proved boot, persisted files
and isolated sessions, but bulk downloads hung and Testcontainers was blocked.
These results do not establish capacity for the current Pi Durable runtime or
select a production VM backend. The archived report is available in Git at
`b74dbe3:research/EXPERIMENT-REPORT.md`; the research tree has been retired.
