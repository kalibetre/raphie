# Current architecture and target design

For interactive maps, request flows, and migration phases, open the
[HTML architecture field guide](architecture.html) directly in a browser.

This file describes the current implementation. The accepted headless direction
and proposed application interfaces are documented in
[headless-runtime.md](headless-runtime.md), with migration slices in
[roadmap.md](roadmap.md). The four migration slices are implemented; the roadmap records verification and later client work.

Decision: use TypeScript 7.0.2 throughout the active monorepo, Hono for the
runtime HTTP transport hosted by Bun, and domain-oriented modules for runtime and browser.
The original research experiments are retired; Git history and an ignored local
archive preserve their sources and legacy data. The active configuration schema
is self-contained at the repository root.

## Compiler and tooling

The native TypeScript 7 compiler does not provide the old JavaScript compiler
API. Keeping a second older compiler solely for lint integrations would defeat
this migration. The previous ESLint/typescript-eslint and Prettier stack is
replaced by Oxfmt (including import sorting), Oxlint, and oxlint-tsgolint's
native type-aware checks. The lockfile pins the entire toolchain. `tsc` points
to TypeScript 7; there is no compatibility compiler installed.

Hook order, effect dependencies, unsafe promises, explicit any, unused values,
and type imports are checked. The two React Compiler-specific rules for render
purity and synchronous effect setters are disabled; React Compiler is not
configured and existing SSR preference hydration uses effects. This does not
disable the normal hooks checks.

## Contexts and dependencies

Conversations own sessions, turns, admission, and transcript projection.
Approvals own decisions, expiry, and execution/delivery state. Attachments own
file limits and display-name policy. Activity owns observable execution history.
Settings owns browser preferences and trusted UI contributions.

Domain policies depend on value types, not React, Hono, Node, or Pi Durable.
Application ports describe commands/read models. Outer adapters implement ports
and apply policies inside durable transactions. Pi Durable definitions and task
phases remain infrastructure because their transaction and recovery semantics
are SDK-specific; pure policies can be tested independently. Browser projections
are pure application functions; React lifecycle and browser synchronization
belong to presentation/infrastructure.

Composition roots wire adapters. Neither channel adapters nor domain handlers
import the process host. Discord receives an explicit channel-services port.
Focused queries assemble public UUID summaries, transcript pages, approvals, phases and inspection data through a Pi adapter. Framework-free DTOs and reusable run/tool/usage projections live in `@raphie/contracts`; the old workspace snapshot remains a compatibility read. No
browser module imports the runtime package.

The architecture check rejects reverse-layer imports, framework dependencies
in core layers, web-to-runtime imports, and non-entrypoint source-root files.
It is a static import check, not a proof of all semantic coupling; adding a
boundary still requires review. SDK-specific adapters may collaborate across
contexts for atomic journal/approval/turn updates in one SQLite transaction.

## HTTP transport

Hono routes replace the handwritten request dispatcher. Bun’s native `Bun.serve` hosts Hono directly; body-limit and validator middleware handle
bounded input; CORS and secure headers use standard middleware. Local Host,
Origin, and client-marker checks remain application-specific middleware.

Route factories receive shared session/approval operations, client query ports and attachment reads. Trusted HTTP and Discord adapters issue runtime-local actor contexts after access checks; application operations reject fabricated contexts. The composition root injects concrete adapters.
Hono's SSE helper owns write backpressure and cancellation. A disconnected
viewer ends its stream without cancelling durable work. Discord webhook input
is bounded separately and passes through the SDK's existing signature checks.

## Persistence and verification

Existing durable document kinds/versions, SQLite paths and attachment locations are retained. Additive channel-binding and delivery-plan documents accompany transactional backfills of legacy routing fields. New focused contracts use UUIDs; legacy HTTP reads and numeric admission remain compatibility adapters. Existing public UUID session identifiers are preserved. The
runtime still writes to root `.data/gateway.sqlite`; browser storage only holds
UI preferences and drafts. No archived database is merged or removed.

Run `bun run validate`. Tests use temporary SQLite databases and deterministic
models. Coverage includes restart recovery, concurrent decisions, uploads,
origin/host rejection, malformed/oversized input, SSE reconnection/backpressure,
redaction, and MCP transports. Browser acceptance uses isolated ports 4317/4321.
CI uses a self-hosted Linux x64 runner and never requires paid model calls.

## Bun execution and package management

Bun 1.4.2 is the pinned, tested runtime and package manager. `bun.lock` replaces
`package-lock.json`; CI uses `bun install --frozen-lockfile`. Built-in parallel
script execution replaces the custom Node child-process launcher. Both HTTP
hosts use `Bun.serve`; the Node Hono adapter and srvx dependency are removed.
Hono’s Bun adapter provides static asset responses for the built Start app.

Tests import `bun:test`, including native spies; filesystem and assertions can
still use Bun’s Node-compatible built-ins. A native `bun:sqlite` driver implements
Pi's public `SqliteDatabase` interface; Pi retains the storage engine, schema,
migrations and recovery. The driver serializes awaited transactions and unrelated
operations on one connection, with WAL and rollback/close guarantees.

`bunfig.toml` disables automatic dotenv loading so Varlock remains the sole
private configuration loader. The web build uses Vite on Bun because TanStack
Start and Tailwind depend on its compiler plugins. See `bun-migration.md` for
verified tooling limits and the acceptance commands.

## Headless modules

`application/sessions` owns shared admission and approval entrypoints, including
compatibility operations for the retained file-copy experiment. `application/access`
issues and verifies process-local actor contexts. The HTTP middleware and Discord
SDK adapter establish identity; a caller's JSON never grants owner access.

`domains/channels` owns scoped bindings. `domains/conversations` persists a frozen
reply destination per channel-origin turn; web-origin turns have none. Tool
approval notifications follow that origin. There is no session-linking operation.

`domains/delivery` owns persisted operation plans and pending/sending/sent/uncertain
transitions. Discord renders whole reply intents into chunks and serializes card,
file and edit payloads before network I/O. Its worker claims only the configured
Discord connection's intents and operations. Original IDs remain intact during
migration. A lost send is uncertain, never automatically repeated.

`application/queries` exposes client reads implemented by `infrastructure/pi`.
The browser composes summary pages and a selected session observation; it no
longer fetches or subscribes to the whole workspace. See the delivered
[HTTP interface and migration record](headless-interface.md) for routes, limits,
recovery verification and the local query baseline.

## Operational tracing

Effect 4's built-in OTLP exporter observes HTTP handlers, shared commands, remote
MCP calls and delivery attempts through a framework-free telemetry port. Normal
bootstrap owns a loopback OTLP JSON receiver and separate Bun SQLite trace store.
Diagnostics queries only that store; session Activity and recovery still use
the durable journal. Trace spans are best-effort operational data.
Payloads and raw errors are excluded. See [observability](observability.md) for
configuration, span meanings, lifetime/recovery limits and tests.
