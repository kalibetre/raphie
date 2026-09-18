import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'

export const pathExists = (fs: FileSystem.FileSystem, filePath: string) =>
  Effect.gen(function* () {
    const isSymlink = yield* fs.readLink(filePath).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    return isSymlink || (yield* fs.exists(filePath))
  })

const readSymlink = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.readLink(filePath).pipe(
    Effect.map((target) => target as string | null),
    Effect.catchAll(() => Effect.succeed(null)),
  )

const canonicalPath = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.realPath(filePath).pipe(
    Effect.map((resolved) => resolved as string | null),
    Effect.catchAll(() => Effect.succeed(null)),
  )

export const isLinkedToCentralEnv = (
  fs: FileSystem.FileSystem,
  worktreeEnvFile: string,
  centralEnvFile: string,
) =>
  Effect.gen(function* () {
    const symlinkTarget = yield* readSymlink(fs, worktreeEnvFile)
    if (symlinkTarget === null) return false

    const linkedPath = yield* canonicalPath(fs, worktreeEnvFile)
    const centralPath = yield* canonicalPath(fs, centralEnvFile)
    return linkedPath !== null && centralPath !== null && linkedPath === centralPath
  })

export const removeIfPresent = (fs: FileSystem.FileSystem, filePath: string) =>
  Effect.gen(function* () {
    if (yield* pathExists(fs, filePath)) yield* fs.remove(filePath)
  })
