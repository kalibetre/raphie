# Raphie

A personal assistant with durable conversations, explicit tool approvals, and an inspectable activity history.

## Run locally

Requires Bun 1.4.2 (pinned in `.bun-version` and `packageManager`).

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:4320**. The runtime listens on **127.0.0.1:4316**. Both bind to loopback.

For a production bundle, run `bun run build`, then `bun run start`. This starts the built TanStack Start server and the independent agent runtime. Bun’s built-in parallel runner starts both; Ctrl+C stops both. Use an external process supervisor for automatic restart; this slice does not install one.

Configuration is loaded through Varlock from the root `.env.schema` and private
root `.env` / `.env.local` values. Use `bun --bun run varlock load --agent` to
inspect masked configuration. New installations can provide the keys named in
the schema through their environment or a private `.env.local` file. A model API
key enables chat; MCP is optional. Bun's automatic dotenv loading is disabled.

The product writes to root `.data/`. Discord is disabled by default; enable it
with `RAPHIE_DISCORD_ENABLED=true` when the owner/channel settings are configured.

## Sessions and storage

Session links use `/sessions/<uuidv7>`. These public IDs are persisted in SQLite; the durable harness still uses its original numeric conversation IDs internally. Existing sessions receive a public ID once on startup, preserving their messages and approvals. Old `/?conversation=<number>` links redirect to the matching session in the current database.

The normal app stores conversations, messages, execution state, and approvals in **`.data/gateway.sqlite`** at the repository root. Attachments live under `.data/files/`. `DATA_DIRECTORY` can select another location; relative paths resolve against the repository root, so changing the shell's working directory cannot silently open a different database. Browser storage holds drafts and UI preferences, not session history.

The old research tree and its legacy server have been retired. Source history
remains in Git. A private local archive, including the older prototype database,
is stored at `.data/backups/research-20261021.tar.gz` and is ignored by Git. Its
sessions were not merged into the active database. See the
[cleanup record](docs/repository-cleanup.md).

Back up SQLite with its backup API, or stop the runtime before copying the
database and WAL files; copying only an active `.sqlite` file can miss recent writes.

The browser fixture uses a temporary database that is removed on normal shutdown. Its `acceptance` model and fake calendar sessions are disposable. It now runs on **4317**, with its UI on **4321**, to keep it separate from the normal app on **4316/4320**.

## Architecture

Raphie is moving toward a headless runtime shared by clients and messaging
channels. See the [target design](docs/headless-runtime.md) and
[migration roadmap](docs/roadmap.md). Inspection interfaces are optional for
messaging channels; cross-channel session continuation is deferred.

- `apps/web`: TanStack Start and Router, React, TanStack Query, shadcn components, and AI Elements composition patterns.
- Both applications organize code under `domains/<context>/{domain,application,infrastructure,presentation}`. Conversations, approvals, activity, attachments, and settings have explicit owners. Source roots contain entrypoints; `bootstrap/` owns wiring. See [architecture](docs/architecture.md).
- `apps/web/src/shared/styles`: theme tokens and separate stylesheets with explicit cascade order. Shared UI primitives live under `shared/ui`.
- `packages/runtime`: an independent Bun host; Effect scopes own MCP, Pi, HTTP, and Discord lifetimes. Pi Durable and SQLite own persistent execution and approval state.
- Hono and Bun’s native server own HTTP dispatch, validation, security middleware, and streaming. Domain presentation handlers receive application ports; Pi Durable adapters own transactional execution. `@raphie/contracts` shares wire types without runtime dependencies.
- The browser gets an initial state snapshot and subscribes to SSE updates. Reconnect replaces the snapshot. Closing a tab only detaches its viewer; it never cancels work or repeats an action.
- TanStack AI's client renders a projection of the durable transcript. It does not own a second model loop, conversation database, or approval store. Our admission endpoint retains stable event IDs for retrying an ambiguous message submission.
- Vite proxies `/api` during development. Start server routes proxy the same API in the production build. API origin and host checks restrict access to the local workspace.

## First slice

Conversations support streamed text, Markdown, saved drafts, history after refresh, and pending/error states. MCP requests show the exact arguments before approval. Web and Discord decisions update the same persisted record. Pending approvals recover with their original deadline; an interrupted external action is marked uncertain and is not automatically repeated.

The activity inspector and Diagnostics page record precise UTC timestamps, local display times, run and runtime-attempt IDs, tool operation IDs, model usage, approval decisions, results, and recovery. Events expand to show payloads and export to JSON. Known credential values and sensitive field names are redacted before journal persistence.

This first journal keeps the latest **5,000 events**, truncates individual diagnostic payloads at **24,000 characters**, and does not persist individual text deltas. Timestamps describe when the host observed an event; “Model response started” is the first observed response, not the start of the provider's network request. Executor's nested calls and private model reasoning are not available here. Operation waterfalls and a backend plugin lifecycle are later work.

## UI plugins

`apps/web/src/domains/settings/infrastructure/plugins/index.tsx` defines host API version 1 and the `composer.footer` slot. Plugins receive `{ draft, model }` and render with shared UI components. The included token counter is an intentionally rough character-based estimate; actual provider usage is separate in Diagnostics.

Plugins are trusted local React modules loaded at build time. Each contribution has a render failure boundary. The Plugins screen saves enable/disable preferences in this browser. This is not an isolation boundary or a third-party plugin marketplace.

## Verify

```sh
bun run validate
```

This runs Oxfmt, architecture checks, native type-aware Oxlint, TypeScript 7, Bun tests, and the production build. Use
`bun run format` and `bun run lint:fix` for automatic fixes. The same validation
runs in CI on a self-hosted runner. See [CONTRIBUTING.md](CONTRIBUTING.md) for
code organization, conventions, and the isolated browser workflow.

Tests cover durable chat, interrupted generation, approvals after restart, concurrent decisions, cross-channel decisions, uncertain execution, file integrity, MCP transports, redaction, viewer disconnection, first-chunk streaming, and TanStack AI transcript replacement.

For browser acceptance without an API key or external actions, run `bun run dev:fixture` and `bun run dev:web:fixture` in separate terminals, then open **http://127.0.0.1:4321**. The fixture streams a deterministic response and proposes a fake calendar tool when asked to use a tool. It can run alongside the normal app. Fixture state is removed when stopped normally.

Bun owns package installation (`bun.lock`), workspace scripts, parallel process
startup, TypeScript execution, native HTTP serving, and the test runner. Oxfmt
and Oxlint remain because the verified Bun releases do not ship the documented
formatter/linter commands yet. The actual TypeScript 7 compiler remains pinned;
Vite remains for TanStack Start and Tailwind’s build plugins. See
[the migration record](docs/bun-migration.md).
