# Cleanup implementation record

The earlier formatting and UI extraction pass was followed by the TypeScript 7,
Hono, and domain-boundary migration. Current organization and tooling are
specified in [architecture.md](architecture.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

Changes include pinned TypeScript 7.0.2, native Oxfmt/Oxlint tooling, shared wire
contracts, explicit domain models/policies/application ports, domain-owned
presentation and persistence adapters, and Hono transport middleware. Root source
files are entrypoints. A checked architecture rule protects dependency direction.

No persisted document schemas, database locations, private configuration, model
settings, archived research, or conversation records were changed by these code
moves. All tests use temporary databases and deterministic models. Existing
integration assertions were preserved; domain and Hono boundary tests were added.

Use `npm run validate` for reproducible validation. A self-hosted CI workflow runs
the same command; it requires a registered runner. See `UI-VERIFICATION.md` for
prior UI acceptance history. Vite's existing client chunk size warning is a
separate optimization concern.

## Verification completed on 2026-10-20

- `npm run validate` passed Oxfmt, architecture boundaries, native type-aware
  Oxlint (zero warnings), all three TypeScript 7 projects, 37 tests, and both
  production bundles. `npm ls typescript --all` reports only 7.0.2.
- The deterministic browser fixture confirmed session creation at UUID routes,
  partial streaming, activity labels, pending approval, approval resolution,
  and settings/plugin rendering. No horizontal page overflow at the measured
  1200-pixel viewport. The preview's accessibility snapshot timed out, so these
  checks used browser interactions and DOM inspection; mobile size was not
  verified because the host ignored the requested viewport size.
- Before restarting the normal local services, confirmed zero pending turns and
  approvals. Created `.data/backups/before-ts7-hono-domains-20261020.sqlite` with
  SQLite's online backup API, mode 0600; integrity check returned `ok`.
- Restarted the normal runtime with `npm run dev:runtime` (existing Varlock
  configuration) and built web with `npm run start:web`. Both respond HTTP 200
  on 4316/4320. The one session and seven turns remained present after restart.
- Fixture services on 4317/4321 were stopped normally. No paid model requests,
  VM changes, private configuration edits, or archived data changes were made.

## MCP shutdown cleanup correction

A delayed process-exit notification exposed a shutdown error reported as a
startup failure. The streamable HTTP adapter's remote `DELETE` rejection escaped
its `finally` block even though the local MCP client was closed. An isolated
session-bearing MCP fixture returning HTTP 500 reproduced the exact
`Failed to terminate session` error before the fix.

Remote session deletion is now best-effort, with a fixed credential-free warning.
Local client close still runs in `finally`, and local cleanup failures still
propagate. Runtime error messages distinguish starting, running, and stopping.
The regression verifies that remote deletion is attempted and its failure does
not reject shutdown. No running service, stored session, or private configuration
was changed for this correction; running processes load it on their next restart.

## Bun migration

The active project now uses Bun for installs, scripts, runtime execution, HTTP
serving, tests, and process orchestration. See [bun-migration.md](bun-migration.md)
for the replacement/retention decisions, clean-install validation, database
backup, and service cutover record. Earlier npm/Node commands above describe the
historical cleanup before this migration.

## Declaration spacing

Oxlint runs `@stylistic/eslint-plugin` 5.10.0 through its JavaScript plugin API.
`style/padding-line-between-statements` requires blank lines around declarations
and exports. `style/lines-between-class-members` separates methods/constructors
while allowing adjacent fields. Existing active source was autofixed; generated
routes, archived research, dependencies, private configuration, and data remain
excluded. Oxfmt preserves the resulting spacing. TypeScript 7 remains the sole
installed compiler; no second linter command or custom text rewriting was added.

Verified that the rules report existing missing blank lines, that `lint:fix`
repairs them, and that formatting leaves them intact. Lint, formatting checks,
and all three TypeScript projects pass. No services or databases were changed.
