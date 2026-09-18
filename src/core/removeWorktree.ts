import { Command, FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import type { Project } from './Domain.ts'

const parseWorktreePaths = (lines: readonly string[]) =>
  lines.filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))

const canonicalPath = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.realPath(filePath).pipe(
    Effect.map((resolved) => resolved as string | null),
    Effect.catchAll(() => Effect.succeed(null)),
  )

/**
 * Removes a secondary Worktree and its files from a Project.
 *
 * Git's `--force` flag is intentional: this action is explicitly destructive
 * and the UI confirms that local changes and untracked files will be removed.
 * The main Worktree and paths Git does not report are rejected before Git is
 * invoked.
 */
export const removeWorktree = (project: Project, worktreePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const requestedPath = yield* canonicalPath(fs, worktreePath)
    const projectPath = yield* canonicalPath(fs, project.folderPath)
    if (requestedPath === null || projectPath === null || requestedPath === projectPath) return false

    const lines = yield* Command.lines(
      Command.make('git', '-C', projectPath, 'worktree', 'list', '--porcelain'),
    ).pipe(Effect.catchAll(() => Effect.succeed([])))
    const listedPaths = yield* Effect.forEach(parseWorktreePaths(lines), (path) => canonicalPath(fs, path), {
      concurrency: 'unbounded',
    })
    if (!listedPaths.includes(requestedPath)) return false

    const exitCode = yield* Command.exitCode(
      Command.make('git', '-C', projectPath, 'worktree', 'remove', '--force', requestedPath),
    ).pipe(Effect.catchAll(() => Effect.succeed(-1)))
    return exitCode === 0
  })
