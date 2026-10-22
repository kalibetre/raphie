# Memory

This guide describes the implemented behavior. Update it whenever memory defaults,
tools, retrieval, storage, provider support or recovery behavior changes. Future
work is tracked separately in the [roadmap](roadmap.md#next-phase-lightweight-execution-memory-and-vm-escalation).

## Using memory

Built-in memory is enabled by default when the runtime has no saved memory
configuration. It needs no separate memory service. A saved disabled setting or
external backend choice is preserved across restarts.

Open **Settings → Memory** to see **Saved memories** immediately, without
knowing a search term. Built-in evidence appears newest first, 25 records at a
time, with the total for the saved owner/assistant scope. Use **Load more** to
continue through the inventory or **Refresh** to reload it. Each record shows its
content, kind, source-turn time and revision. Expand **Source and record ID** to
inspect provenance; runtime-created session references link to the original
conversation.

Type to filter the list after a short delay; Search and Enter also submit the
query. **Clear search** returns to the full paginated inventory. Search returns
up to eight matching records, while browsing can page through every current
record. External providers use Search or Enter explicitly; Hindsight does not yet
support browsing all records through Raphie.

Correct or forget built-in evidence from its card. Forgetting updates the visible
count. An empty scope has an explicit empty state. The browser always shows the
saved configuration; changing an unsaved connection draft does not redirect it.
Backend and scope controls are below the inventory. Wait for active turns to
finish before saving configuration changes.

For example, ask Raphie:

- “Remember that I prefer jasmine tea.”
- In a new session: “What tea do I prefer?”
- “Correct that preference: I prefer coffee now.”
- “Forget my drink preference.”

These are natural-language requests to the agent. The model must call the
corresponding memory tools for them to take effect. A successful retain result
contains an evidence ID; an assistant's unsupported claim that it remembered
something does not prove a write. Use the evidence browser to inspect the record.

## How built-in memory works

1. **Select evidence.** The conversation model can call `memory_retain` with a
   useful fact or confirmed experience. Instructions tell it to retain selected
   information and avoid secrets, guesses and unconfirmed outcomes. This selection
   is model behavior; there is no separate fact-verification service.
2. **Stamp and store it.** The runtime supplies the configured scope, a stable
   evidence ID, a session/turn source reference and a timestamp. A SQLite
   transaction writes the evidence, its search entry and a replay receipt.
3. **Retrieve it later.** A session in the same scope can call `memory_recall`.
   SQLite full-text search returns a bounded list of matching records, including
   their IDs, source references, timestamps and revisions.
4. **Use it in a reply.** The conversation model receives that evidence and is
   instructed to cite it and distinguish recorded information from inference.
   `memory_reflect` supplies the same local search results with guidance for this
   synthesis. The memory service itself does not make a separate model call.
5. **Maintain current evidence.** Correction replaces a record's content and
   increments its revision. Forgetting removes the current record and its search
   entry. Both changes happen transactionally.

Enabling memory makes the tools available for use; it does not guarantee the model
will retain every useful statement or search before every reply. There is no
automatic transcript ingestion or unconditional memory injection at the start of
each turn. Existing conversation history remains available within its session.

## What is stored

The runtime opens `DATA_DIRECTORY/memory.sqlite`, defaulting to
`.data/memory.sqlite` at the repository root. It is separate from
`gateway.sqlite`, which owns conversations and durable execution.

| Stored item           | Purpose                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| Evidence ID and scope | Identify a record within the configured namespace.                                     |
| Content               | The selected fact or experience, up to 8,000 characters.                               |
| Kind                  | `fact` or `experience`, selected by the model.                                         |
| Source                | A reference of the form `session:<session-id>/turn:<turn-id>`.                         |
| Event time            | Currently the source turn's creation time in milliseconds.                             |
| Revision              | Starts at 1 and increases when content is corrected.                                   |
| Replay receipt        | Remembers that an evidence ID has already been retained.                               |
| Configuration         | Enabled state, provider, scope, endpoint, bank ID and encrypted connection credential. |
| Search index          | SQLite FTS5 entries for current evidence.                                              |

The timestamp does not yet represent an independently extracted real-world event
date. Corrections keep the original source/time and increment the revision; there
is no separate correction-history table. Source references identify context but
are not an independent check that a claim is true.

Built-in evidence and its search index are ordinary SQLite content, without
application-level encryption. External connection credentials are encrypted using
the existing Settings cipher and OS-held master key; read responses expose only
whether a key is saved. See [credential storage](provider-credential-storage.md)
for that mechanism's threat model and recovery requirements.

Local storage does not imply that retrieved content stays on this machine:
evidence returned to the conversation is sent to its configured model provider as
part of the model context. Selecting Hindsight also sends memory operations to
that configured service.

## Search and reflection

Browsing lists current evidence by source-turn time descending, breaking ties by
evidence ID. Pagination uses a cursor rather than an offset so newly retained
records do not cause repeated rows in subsequent pages. Refresh starts again at
the newest record. The total reflects the current scope and can change while
browsing. Browsing reads SQLite directly and makes no model call.

Built-in recall extracts up to 24 distinct letter/number terms from the query,
combines them with OR, filters to the configured scope, and returns at most eight
records ordered by SQLite FTS5 rank. Query length is limited to 2,000 characters.
Search is lexical: a query for “beverages” may miss evidence containing only “tea.”
There are no embeddings, synonym expansion, entity graph or recency weighting in
this slice.

Built-in reflection has no separate reasoning or consolidation engine. The tool
returns the retrieved evidence plus an instruction for the conversation model to
synthesize an answer. When no evidence matches, it explicitly says no relevant
evidence was found. There is no independently validated citation or inference
checker. Reflections are not automatically saved as new facts.

Background consolidation, contradiction resolution, temporal reasoning and
retrieval-quality evaluation remain planned. Changing the selected conversation
model can change retention choices, search queries and the quality of synthesis.

## Scope, switching and disabling

The initial scope is `owner`. Sessions using the same backend and scope can
retrieve the same evidence. The model cannot supply a different scope as a tool
argument; Settings controls it. The current scope is a namespace for this
single-owner runtime, not a multi-user authentication system.

Changing scope leaves the previous scope's records intact. Switching backends
leaves data at its original backend. There is one active configuration per
runtime; there is no connection library, automatic migration, synchronization,
dual write or fallback during an outage. Switching back to built-in memory and
the original scope makes its existing evidence available again.

Disabling memory rejects memory operations while keeping existing evidence. It
does not erase data. Re-enabling restores access. Configuration changes and memory
operations share the admission gate; pending turns block configuration changes so
an unfinished turn cannot be silently redirected to another backend.

## Correction, forgetting and recovery

Correction and forgetting affect current built-in evidence and its search index.
The service keeps no persistent derived summaries that need separate invalidation.
Old conversation messages, tool outputs, previously generated replies, backups
and forensic storage remnants are outside that deletion. An existing session can
still contain the old information in its transcript.

Replay receipts survive both correction and forgetting. Retaining the same
evidence ID again becomes a no-op, so replay cannot overwrite a correction or
resurrect a forgotten source. This deduplicates a repeated ID, not semantically
similar facts retained through separate tool calls.

Evidence IDs are derived from the session ID and durable tool-call ID. Memory
tools are registered as unsafe to replay automatically. If the process dies after
a write but before its tool result is recorded, the write can exist without a
confirmed result; recovery does not repeat the tool. Inspect evidence before
requesting another write. Tests cover process termination at this boundary.

## Backend support

| Backend             | Status                                                 | Retrieval and reflection                                                             | Correction / forgetting through Raphie             |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Raphie built-in     | Implemented; default                                   | FTS5 evidence search; conversation-model synthesis                                   | Available for current evidence.                    |
| Hindsight           | Connector implemented; tested with a local API fixture | Synchronous retention, tag-filtered recall and provider reflection                   | Manage sources in Hindsight for now.               |
| Honcho              | Planned                                                | Adapter semantics still to be implemented.                                           | Planned.                                           |
| Obsidian / Markdown | Planned                                                | Vault indexing, external edits and model-assisted synthesis still to be implemented. | Must preserve authored notes and detect conflicts. |

Hindsight requires an existing deployment and bank. Configure its endpoint, bank
ID and optional API key in Settings. Use HTTPS, or HTTP on loopback for local
servers. Changing the destination with a saved key requires re-entering or
clearing the key. Requests do not follow redirects or automatically retry writes.
Connection testing reads the bank; it does not insert a sample memory.

Use a dedicated bank. Scope tags filter retrieval; they are not tenant isolation.
Hindsight's native consolidation and reasoning remain provider responsibilities.
Live-deployment compatibility and quality/cost evaluation are still outstanding.

## Implementation and verification

- [Wire contracts](../packages/contracts/src/memory/views.ts)
- [Memory application ports](../packages/runtime/src/domains/memory/application/ports.ts)
- [Runtime configuration and routing](../packages/runtime/src/domains/memory/infrastructure/runtime-memory.ts)
- [Built-in evidence and FTS5 adapter](../packages/runtime/src/domains/memory/infrastructure/builtin-memory.ts)
- [Agent tools and provenance](../packages/runtime/src/domains/memory/infrastructure/pi-memory-tools.ts)
- [Hindsight adapter](../packages/runtime/src/domains/memory/infrastructure/hindsight-memory.ts)
- [Settings UI](../apps/web/src/domains/settings/presentation/memory-settings.tsx)
- [Memory regression tests](../packages/runtime/test/memory.test.ts)
- [Settings browser check](../scripts/check-memory-settings.browser.js)
- [Inventory browser check](../scripts/check-memory-browse.browser.js)

Run `bun test packages/runtime/test/memory.test.ts` for focused runtime checks, or
`bun run validate` for repository validation. Tests use temporary databases and
synthetic credentials. Browser acceptance uses `bun run dev:fixture` and
`bun run dev:web:fixture`; see [contributing](../CONTRIBUTING.md#verification-and-data).

The HTTP surface is under `/api/memory`: configuration read/write, saved-connection
testing, paginated inventory, recall, correction and forgetting. Retention and reflection are agent
operations in this slice; there are no HTTP retain/reflect routes. The
[route adapter](../packages/runtime/src/domains/memory/presentation/http/routes.ts)
is the reference for exact request schemas and paths. Browsing uses
`GET /api/memory/evidence`, returning `{ evidence, total, next }`. Pass a non-null
`next` value as the `after` query parameter to load another page of at most 25
records. An invalid cursor is rejected; external adapters without browsing
capability return an explicit unsupported-operation error.

For pagination browser acceptance, start a disposable fixture with
`RAPHIE_FIXTURE_MEMORY_HISTORY=true`; this seeds 60 synthetic evidence records.
The normal fixture leaves the inventory empty unless the fixture agent saves
something. Never seed the normal application database for this check.
