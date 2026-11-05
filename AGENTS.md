# Raphie

Raphie is a self-hosted assistant platform: a Bun/TypeScript agent runtime plus a React web workspace, where each persistent "bot" has its own instructions, memory, workspace and scheduled work.

This is a Bun workspace monorepo. Use Bun for everything, at the version in `.bun-version`; install with `bun install --frozen-lockfile`. Dependencies are pinned, so keep upgrades out of feature or refactor changes.

## Language

Use the terms in [CONTEXT.md](CONTEXT.md) in code, docs and conversation. A bot is not a session, a bot's workspace is not the web workspace, and a turn is not a message. Read it before naming anything new.

## Before you call something done

```sh
bun fmt && bun run lint:fix   # formatting and declaration spacing
bun run validate              # format, architecture, lint, types, tests, build
```

`validate` is exactly what CI runs, and warnings fail it. Missing blank lines around declarations are a lint failure, not a style nit. TypeScript 7 is the only compiler.

## Architecture rules

Both the runtime and the web app are organised by domain, with layers (`domain`, `application`, `infrastructure`, `presentation`) that only depend inward. `bun run architecture` enforces the dependency direction, so run it when moving code. Details and reasoning are in [docs/architecture.md](docs/architecture.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

- The browser depends on `@raphie/contracts`, never on runtime internals.
- Domain and application code stay framework-free.
- Source roots hold entrypoints only.
- Do not hand-edit generated route trees.

## UI work

- Use shadcn components built on Base UI. Do not add Radix or native controls where a shadcn one exists.
- Scope CSS to explicit class names. Never use `> div` or bare element descendant selectors, since they have stretched unrelated controls before.
- Use the shared scroll area for scrolling regions; see [docs/ui-scrolling.md](docs/ui-scrolling.md).
- Before reporting UI work as finished, look at every changed screen in light and dark mode at 2x zoom and at a mobile width. DOM metrics and small screenshots miss misalignment.

## Running and testing safely

- Tests use `bun:test` with temporary databases and make no model calls. Prefer the mock model and mock integrations; only make a real model call when asked, and keep it small, since tokens cost money.
- For UI checks use the isolated fixture (`bun run dev:fixture`, then `bun run dev:web:fixture`), not the normal app. Fixture ports are 4317/4321; the real app is 4316/4320 and keeps its data in `.data/`.
- Never use real conversations as test data, and never delete or overwrite `.data/`.
- Credentials go through Varlock. Never print or commit their values. Check configuration with `bun --bun run varlock load --agent`.
- Before stopping a process on a port, check what it is. Stop only Raphie processes you started.

## Documentation

Docs are part of the change. When behaviour, defaults, settings, storage or API contracts change, update the matching guide in `docs/` in the same change. Keep planned work visibly separate from delivered work. The docs index is [docs/README.md](docs/README.md).
