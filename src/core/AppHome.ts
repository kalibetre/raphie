import { Context, Effect, Layer } from 'effect'

/** Root directory for raphie's local Vault and other application state. */
export class AppHome extends Context.Tag('AppHome')<AppHome, string>() {}

// ponytail: env override is a one-line test seam, not a general config system —
// upgrade to a real settings mechanism if raphie ever needs more than this.
// Read lazily (Layer.effect, not Layer.succeed) so a test can flip RAPHIE_HOME
// between runs without needing to bust any module cache.
// `process.env`, not `Bun.env`: this must also work under vitest's test
// workers, which run without the `Bun` global even when launched via `bun
// run test` — `process` is the one env accessor both environments share.
export const AppHomeLive = Layer.effect(
  AppHome,
  Effect.sync(() => process.env.RAPHIE_HOME ?? `${process.env.HOME}/.config/raphie`),
)
