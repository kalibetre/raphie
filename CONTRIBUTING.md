# Contributing

Use the Bun version in `.bun-version` from the repository root. Install with `bun install --frozen-lockfile`; the
manifest versions and lockfile are pinned. Keep dependency upgrades separate
from refactoring so behavior changes are reviewable.

## Before submitting a change

```sh
bun fmt
bun run lint:fix
bun run validate
```

`validate` checks formatting, architecture rules, linting, TypeScript, tests,
and the production build. CI runs the same command on a GitHub-hosted Linux x64 runner with the
pinned Bun version and builds the container test fixture first. It does not
require model credentials or connected integrations.

Bun's built-in `bun fmt` owns formatting and import sorting, configured in
`bunfig.toml`. Oxlint with its native type-aware
checker owns correctness, type imports, hooks, and promise handling. TypeScript
7.0.2 is the sole compiler; do not introduce an older compiler to support a tool.
Warnings fail validation. React Compiler diagnostics (`purity` and
`set-state-in-effect`) are disabled because this app does not use that compiler;
standard hook ordering and dependency checks remain enforced. Browser preference
hydration currently synchronizes local storage in effects.

Oxlint also runs the Stylistic declaration-spacing rules. Leave a blank line
before and after type aliases, interfaces, enums, classes, function declarations,
and exports. Class methods (including constructors) require separation; related
fields and properties can stay grouped. `bun fmt` preserves these blank lines.
Use `bun run lint:fix` to insert missing spacing, followed by `bun fmt`.
Missing spacing fails `bun run lint` and CI; it is not just a visual convention.

Generated routes, build output, local databases, dependencies, and private
configuration are excluded. Vite generates
`apps/web/src/bootstrap/routeTree.gen.ts`; do not edit it by hand.

## Organizing code

Both applications follow domain boundaries. See [the architecture overview](https://raphie-docs.kalibetre.dev/architecture/overview/)
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

Sign-in is always required, including for the fixture; there is no bypass flag.
The fixture's web host keeps its own sign-in store in `.fixture-data/` at the
checkout root, never in `.data/`. Create its administrator once with
`bun run fixture:auth` and sign in at the fixture URL. Browser check scripts run
in a tab that is already signed in.

The normal application uses ports 4316/4320 and persists to `.data/`. The fixture
uses 4317/4321; its runtime removes its temporary data on shutdown, and its sign-in
store stays in `.fixture-data/` until you delete it. Never replace the
normal runtime with the fixture or use production conversations as test data.

Tests use `bun:test` and temporary databases. The root test script explicitly
selects the project test directories. Keep test
assertions unchanged during pure code moves and formatting; add regression
tests when observable behavior changes.

Keep credentials in private configuration, load them through Varlock, and
never print their values. Use `bun --bun run varlock load --agent` for masked
validation. Preserve `.data/`, including its private legacy archive, during cleanup.

## Documentation

The documentation site lives in `apps/docs`; its pages are the only copy of the
guides. Update the matching page in the same change that changes product
behavior: defaults, Settings controls, storage, API or tool contracts, recovery
behavior and provider differences. Describe model-dependent behavior as such,
and keep planned work out of guides. Diagrams use the HTML components in `apps/docs/src/components/diagram`.
[Writing docs](apps/docs/WRITING.md) covers the structure, voice and checks.

## Scrolling and the composer

Use `shared/ui/scroll-area` for scrolling panels, code/details and wide tables.
Use Base UI for shadcn components; do not add Radix primitives or dependencies.
Each panel has one Base UI viewport; its flex/grid ancestors need `min-height: 0`
and must not add a competing `overflow: auto`. Connect `useStickToBottom` directly
to the transcript viewport and content refs instead of adding another scroller.

The composer floats inside `chat-stage`. Its measured height supplies transcript
bottom padding and the jump-button offset, including multiline drafts and errors.
Preserve last-message clearance while letting older messages scroll underneath.
See [UI conventions](https://raphie-docs.kalibetre.dev/contribute/ui-conventions/) for the long-history fixture and browser probe.
