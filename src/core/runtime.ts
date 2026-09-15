import { BunContext } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { AppHomeLive } from './AppHome.ts'

export const AppLive = Layer.merge(BunContext.layer, AppHomeLive)

/**
 * The one place that turns an unexpected I/O failure into a crash instead of
 * a typed, recoverable error — fine while nothing in the UI needs to tell a
 * permission error apart from a disk-full error. Revisit if it ever does.
 */
export const run = <A>(effect: Effect.Effect<A, unknown, Layer.Layer.Success<typeof AppLive>>) =>
  Effect.runPromise(Effect.provide(effect, AppLive).pipe(Effect.orDie))
