import { FileSystem, Path } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { Effect, Layer, type Scope } from 'effect'
import { AppHome } from '../../src/core/AppHome.ts'

/**
 * Runs `test` against a real temp AppHome and a real temp Project folder,
 * both on the real Bun filesystem (no mocks — see ADR 0001) and both removed
 * automatically when the Effect scope closes. `test` may itself open more
 * scoped resources (e.g. another `makeTempDirectoryScoped`) against the same
 * scope.
 */
export const withProjectFixtures = <A, E>(
  test: (fixtures: {
    readonly home: string
    readonly projectFolder: string
  }) => Effect.Effect<A, E, AppHome | FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const home = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-home-' })
      const projectFolder = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-project-' })
      return yield* test({ home, projectFolder }).pipe(Effect.provide(Layer.succeed(AppHome, home)))
    }),
  ).pipe(Effect.provide(BunContext.layer), Effect.runPromise)
