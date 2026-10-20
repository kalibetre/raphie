# Bun migration

Bun 1.4.2 is pinned in `.bun-version` and `packageManager`. The existing global
installation is unchanged. CI remains on a self-hosted Linux x64 runner.

## Replaced

- npm install/workspace execution → Bun install and workspace scripts.
- npm lockfile → committed, text `bun.lock`; use `bun install --frozen-lockfile`.
- Node execution → Bun for runtime, web host, Vite, Varlock, fixtures, and scripts.
- Node test runner → `bun:test`, with native spies and the same semantic assertions.
- Custom `scripts/dev.mjs` launcher → `bun run --parallel`.
- `@hono/node-server` and `srvx` → native `Bun.serve`; Hono handles routing,
  security middleware, SSE, and static assets through `@hono/bun`.

## Retained deliberately

TypeScript 7.0.2 remains the actual type checker. Oxfmt and type-aware Oxlint
retain formatting, import sorting, hooks, and promise checks. The installed Bun
1.4.2 and an isolated official 1.4.3 binary both reject `bun fmt` and `bun lint`
with `Script not found`, although current documentation describes them. Bun
1.4.3 has a built-in checker reporting TypeScript 7.0.2; we retain the explicitly
pinned compiler rather than change type-checker implementation in this migration.

Vite is still required for TanStack Start's route/SSR compilation and Tailwind
plugins. Varlock still validates and injects sensitive configuration. Automatic
Bun dotenv loading is disabled in `bunfig.toml`; no private values were edited.

Pi Durable's official SQLite adapter uses Bun's `node:sqlite` compatibility.
This is Bun execution, with no Node subprocess for storage. Building our own
`bun:sqlite` adapter would duplicate the SDK's transaction queue and recovery
contract. Durable document schemas, SQLite location, and attachment paths remain
unchanged.

## Commands

```sh
bun install --frozen-lockfile
bun run dev
bun run validate
bun run build
bun run start
```

For deterministic UI checks use `bun run --parallel dev:fixture dev:web:fixture`.
These run on 4317/4321 with temporary data; normal services stay on 4316/4320.
The root test command names active directories explicitly, so it does not run
archived research tests.

## Acceptance completed on 2026-10-20

- `bun run validate` passed formatting, architecture checks, type-aware linting,
  all three TypeScript 7 projects, 39 Bun tests, and client/SSR production builds.
- Repeated the entire validation after a fresh `bun install --frozen-lockfile`
  in a source-only temporary copy, with no original `node_modules`, private
  configuration, persisted data, or Node setup step. The copy initially omitted
  `.gitignore`; correcting that and explicitly excluding dependency directories
  made the verification match the repository's intended scope.
- The built Start app on Bun served assets and proxied live state, streamed a
  deterministic reply, displayed an approval, and completed its fake tool action
  after approval. Browser fixture checks used 4317/4321, with no paid model calls.
- Bun's parallel runner stopped both fixture listeners on Ctrl+C. Fixtures are
  stopped; normal listeners remain on 4316/4320 and were verified as Bun processes.
- Before switching the normal services, confirmed no pending turns/approvals.
  SQLite online backup: `.data/backups/before-bun-migration-20261020.sqlite`,
  mode 0600, integrity check `ok`. The one session and seven turns survived the
  switch unchanged. No private configuration, archived data, or VM was modified.
- Varlock's masked validation passed under Bun. CI is updated for the self-hosted
  runner but has not been run there. The existing large client-chunk warning and
  missing-route warning remain outside this runtime migration. Closing streamed
  browser connections can still emit an AbortError from the Start server.

To check the built app on fixture ports:

```sh
RAPHIE_WEB_PORT=4321 RAPHIE_WEB_ORIGIN=http://127.0.0.1:4321 RAPHIE_RUNTIME_URL=http://127.0.0.1:4317 bun run --parallel dev:fixture start:web
```
