# Domain boundaries and native TypeScript tooling

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
Cross-context reads are assembled into a workspace snapshot by an infrastructure
adapter, then exposed via the framework-free `@raphie/contracts` package. No
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

Route factories receive conversation, approval, and attachment ports. The
composition root injects concrete services and the workspace snapshot reader.
Hono's SSE helper owns write backpressure and cancellation. A disconnected
viewer ends its stream without cancelling durable work. Discord webhook input
is bounded separately and passes through the SDK's existing signature checks.

## Persistence and verification

No durable document kind/version, public API payload, SQLite path, or attachment
location changes. Existing public UUID session identifiers are preserved. The
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
still use Bun’s Node-compatible built-ins. Pi Durable’s maintained `node:sqlite`
adapter runs on Bun’s SQLite compatibility implementation. This avoids a custom
storage adapter and preserves transactional/recovery semantics and file format.

`bunfig.toml` disables automatic dotenv loading so Varlock remains the sole
private configuration loader. The web build uses Vite on Bun because TanStack
Start and Tailwind depend on its compiler plugins. See `bun-migration.md` for
verified tooling limits and the acceptance commands.
