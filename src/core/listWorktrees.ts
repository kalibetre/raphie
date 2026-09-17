import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import type { Project, Worktree } from './Domain.ts'

const parseWorktreePaths = (lines: readonly string[]) =>
  lines.filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))

const canonicalPath = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.realPath(filePath).pipe(
    Effect.map((resolved) => resolved as string | null),
    Effect.catchAll(() => Effect.succeed(null)),
  )

const isLinkedToCentralEnv = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  worktreePath: string,
  centralEnvPath: string | null,
) =>
  Effect.gen(function* () {
    if (centralEnvPath === null) return false

    const envFile = path.join(worktreePath, '.env')
    const isSymlink = yield* fs.readLink(envFile).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    if (!isSymlink) return false

    return (yield* canonicalPath(fs, envFile)) === centralEnvPath
  })

/**
 * Lists every Worktree Git reports for a Project, including the main Worktree.
 * Link status is derived from the current filesystem on every call; it is not
 * persisted with the Project.
 *
 * A Project that is not a Git repository has no Worktrees and therefore returns
 * an empty list.
 */
export const listWorktrees = (project: Project) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lines = yield* Command.lines(
      Command.make('git', '-C', project.folderPath, 'worktree', 'list', '--porcelain'),
    ).pipe(Effect.catchAll(() => Effect.succeed([])))
    const worktreePaths = parseWorktreePaths(lines)
    const centralEnvPath = yield* canonicalPath(fs, project.centralEnvFile)

    return yield* Effect.forEach(worktreePaths, (worktreePath) =>
      isLinkedToCentralEnv(fs, path, worktreePath, centralEnvPath).pipe(
        Effect.map((linked): Worktree => ({ path: worktreePath, linked })),
      ),
    )
  })
