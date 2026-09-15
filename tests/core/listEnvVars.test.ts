import { FileSystem } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { Effect, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { listEnvVars } from '../../src/core/listEnvVars.ts'

/** Runs `test` against a real temp Central env file, on the real Bun filesystem (no mocks — see ADR 0001). */
const withEnvFile = <A, E>(
  content: string,
  test: (file: string) => Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-envfile-' })
      const file = `${dir}/.env`
      yield* fs.writeFileString(file, content)
      return yield* test(file)
    }),
  ).pipe(Effect.provide(BunContext.layer), Effect.runPromise)

describe('listEnvVars', () => {
  it('parses key=value pairs from a real Central env file', () =>
    withEnvFile('FOO=bar\nBAZ=qux\n', (file) =>
      Effect.gen(function* () {
        expect(yield* listEnvVars(file)).toEqual([
          { key: 'FOO', value: 'bar' },
          { key: 'BAZ', value: 'qux' },
        ])
      }),
    ))

  it('skips blank lines and comment lines', () =>
    withEnvFile('# a comment\n\nFOO=bar\n  \n# another\nBAZ=qux\n', (file) =>
      Effect.gen(function* () {
        expect(yield* listEnvVars(file)).toEqual([
          { key: 'FOO', value: 'bar' },
          { key: 'BAZ', value: 'qux' },
        ])
      }),
    ))

  it('strips matching surrounding quotes from a value', () =>
    withEnvFile('FOO="bar"\nBAZ=\'qux\'\n', (file) =>
      Effect.gen(function* () {
        expect(yield* listEnvVars(file)).toEqual([
          { key: 'FOO', value: 'bar' },
          { key: 'BAZ', value: 'qux' },
        ])
      }),
    ))

  it('skips a malformed line with no "="', () =>
    withEnvFile('not-a-valid-line\nFOO=bar\n', (file) =>
      Effect.gen(function* () {
        expect(yield* listEnvVars(file)).toEqual([{ key: 'FOO', value: 'bar' }])
      }),
    ))

  it('returns an empty list for an empty Central env file', () =>
    withEnvFile('', (file) =>
      Effect.gen(function* () {
        expect(yield* listEnvVars(file)).toEqual([])
      }),
    ))

  it('returns an empty list when the Central env file does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-envfile-' })
        expect(yield* listEnvVars(`${dir}/.env`)).toEqual([])
      }),
    ).pipe(Effect.provide(BunContext.layer), Effect.runPromise))
})
