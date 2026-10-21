# Contributing

Use the Bun version in `.bun-version` from the repository root. Install with `bun install --frozen-lockfile`; the
manifest versions and lockfile are pinned. Keep dependency upgrades separate
from refactoring so behavior changes are reviewable.

## Before submitting a change

```sh
bun run format
bun run lint:fix
bun run validate
```

`validate` checks formatting, linting, TypeScript, tests, and the production
build. CI runs the same command on a self-hosted Linux x64 runner with the pinned Bun version.
It does not require model credentials or connected integrations. Register a
self-hosted runner before relying on GitHub's workflow status.

Oxfmt owns formatting and import sorting. Oxlint with its native type-aware
checker owns correctness, type imports, hooks, and promise handling. TypeScript
7.0.2 is the sole compiler; do not introduce an older compiler to support a tool.
Warnings fail validation. React Compiler diagnostics (`purity` and
`set-state-in-effect`) are disabled because this app does not use that compiler;
standard hook ordering and dependency checks remain enforced. Browser preference
hydration currently synchronizes local storage in effects.

Oxlint also runs the Stylistic declaration-spacing rules. Leave a blank line
before and after type aliases, interfaces, enums, classes, function declarations,
and exports. Class methods (including constructors) require separation; related
fields and properties can stay grouped. Oxfmt preserves these blank lines.
Use `bun run lint:fix` to insert missing spacing, followed by `bun run format`.
Missing spacing fails `bun run lint` and CI; it is not just a visual convention.

Generated routes, build output, local databases, dependencies, and private
configuration are excluded. Vite generates
`apps/web/src/bootstrap/routeTree.gen.ts`; do not edit it by hand.

## Organizing code

Both applications follow domain boundaries. See [the architecture decision](docs/architecture.md)
and [CONTEXT.md](CONTEXT.md) for the shared language.

- `domains/<context>/domain` holds framework-free models and business policies.
- `domains/<context>/application` defines use-case ports and pure projections.
  These layers cannot import transport, persistence, UI, or bootstrap modules.
- `domains/<context>/infrastructure` adapts Pi Durable, storage, or browser APIs.
  Durable transaction/workflow adapters enforce domain policies atomically.
- `domains/<context>/presentation` holds React UI or Hono handlers. HTTP handlers
  receive application ports; they do not construct a harness or access SQLite.
- Cross-context workspace UI lives under `presentation/workspace`; cross-context
  integration ports live under `application/`. Generic transport adapters live
  under `infrastructure/`; reusable UI, styles, and platform helpers under `shared/`.
- `bootstrap/` wires implementations and owns process lifecycle and routes.
  Source roots hold entrypoints only (`main.ts` and `router.tsx`).
- `@raphie/contracts` is a framework-free wire contract. Web code never imports
  runtime implementation types. Domain types may use its shared value types.

`bun run architecture` enforces dependency direction and source-root hygiene.
The validation suite tests these rules against forbidden dependencies too.
Add modules for meaningful responsibilities; avoid broad miscellaneous files
or wrappers with no useful boundary. Keep styles in `shared/styles`, within the
existing cascade layers.

Use descriptive names, early returns, and named components instead of nested
conditional expressions. Preserve error handling and comments that explain
why a durability, security, or lifecycle rule exists.

## Verification and data

Use the isolated browser fixture for UI acceptance:

```sh
# Terminal 1: temporary runtime, no model calls
bun run dev:fixture
# Terminal 2: UI at http://127.0.0.1:4321
bun run dev:web:fixture
```

The normal application uses ports 4316/4320 and persists to `.data/`. The fixture
uses 4317/4321 and removes its temporary database on shutdown. Never replace the
normal runtime with the fixture or use production conversations as test data.

Tests use `bun:test` and temporary databases. The root test script explicitly
selects the project test directories explicitly. Keep test
assertions unchanged during pure code moves and formatting; add regression
tests when observable behavior changes.

Keep credentials in private configuration, load them through Varlock, and
never print their values. Use `bun --bun run varlock load --agent` for masked
validation. Preserve `.data/`, including its private legacy archive, during cleanup.
