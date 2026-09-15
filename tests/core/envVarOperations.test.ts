import { FileSystem } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { Effect, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { deleteEnvVar, DuplicateEnvVarKeyError, setEnvVar } from '../../src/core/index.ts'
import { listEnvVars } from '../../src/core/listEnvVars.ts'

/** Runs `test` against a real temp Central env file, on the real Bun filesystem. */
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

describe('EnvVar file operations', () => {
  it('adds a new EnvVar to the Central env file', () =>
    withEnvFile('EXISTING=one\n', (file) =>
      Effect.gen(function* () {
        expect(yield* setEnvVar(file, { key: 'NEW_KEY', value: 'two' })).toEqual({ key: 'NEW_KEY', value: 'two' })
        expect(yield* listEnvVars(file)).toEqual([
          { key: 'EXISTING', value: 'one' },
          { key: 'NEW_KEY', value: 'two' },
        ])
      }),
    ))

  it('updates an EnvVar key and multiline value in place', () =>
    withEnvFile('# keep this comment\nOLD_KEY=old\nOTHER_KEY=other\n', (file) =>
      Effect.gen(function* () {
        yield* setEnvVar(
          file,
          { key: 'RENAMED_KEY', value: 'first line\nsecond line' },
          { previousKey: 'OLD_KEY' },
        )

        expect(yield* listEnvVars(file)).toEqual([
          { key: 'RENAMED_KEY', value: 'first line\nsecond line' },
          { key: 'OTHER_KEY', value: 'other' },
        ])
        expect(yield* fsRead(file)).toContain('# keep this comment')
      }),
    ))

  it('rejects adding or renaming an EnvVar to a duplicate key', async () => {
    const result = await withEnvFile('ONE=1\nTWO=2\n', (file) =>
      Effect.either(setEnvVar(file, { key: 'ONE', value: 'updated' })),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') expect(result.left).toBeInstanceOf(DuplicateEnvVarKeyError)
  })

  it('rejects renaming an EnvVar to a duplicate key', async () => {
    const result = await withEnvFile('ONE=1\nTWO=2\n', (file) =>
      Effect.either(setEnvVar(file, { key: 'TWO', value: 'updated' }, { previousKey: 'ONE' })),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') expect(result.left).toBeInstanceOf(DuplicateEnvVarKeyError)
  })

  it('deletes the requested EnvVar from the Central env file', () =>
    withEnvFile('KEEP=yes\nREMOVE=gone\n', (file) =>
      Effect.gen(function* () {
        expect(yield* deleteEnvVar(file, 'REMOVE')).toBe(true)
        expect(yield* listEnvVars(file)).toEqual([{ key: 'KEEP', value: 'yes' }])
      }),
    ))
})

const fsRead = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(file)
  })
