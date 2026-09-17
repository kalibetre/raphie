import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import type { Project, Worktree, WorktreeCommit } from './Domain.ts'

const parseWorktreePaths = (lines: readonly string[]) =>
  lines.filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))

const commandText = (command: Command.Command) =>
  Command.string(command).pipe(
    Effect.map((output) => output.trim()),
    Effect.catchAll(() => Effect.succeed('')),
  )

const commandLines = (command: Command.Command) =>
  Command.lines(command).pipe(Effect.catchAll(() => Effect.succeed([])))

const parseLastCommit = (output: string): WorktreeCommit | null => {
  const [hash, date, subject] = output.split('\x1f')
  if (!hash || !date || subject === undefined) return null
  return { hash, date, subject }
}

const countStagedChanges = (lines: readonly string[]) =>
  lines.filter((line) => {
    const indexStatus = line.charAt(0)
    return indexStatus !== '' && indexStatus !== ' ' && indexStatus !== '?'
  }).length

const countUnstagedChanges = (lines: readonly string[]) =>
  lines.filter((line) => line.startsWith('??') || line.charAt(1) !== ' ').length

const readWorktreeMetadata = (worktreePath: string) =>
  Effect.gen(function* () {
    const branchOutput = yield* commandText(Command.make('git', '-C', worktreePath, 'branch', '--show-current'))
    const commitOutput = yield* commandText(
      Command.make('git', '-C', worktreePath, 'log', '-1', '--date=iso-strict', '--format=%h%x1f%ad%x1f%s'),
    )
    const statusLines = yield* commandLines(
      Command.make('git', '-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all'),
    )
    const sizeOutput = yield* commandText(Command.make('du', '-sk', worktreePath))
    const kilobytes = Number(sizeOutput.split(/\s+/)[0])

    return {
      size: Number.isFinite(kilobytes) ? kilobytes * 1024 : 0,
      branch: branchOutput || null,
      lastCommit: parseLastCommit(commitOutput),
      stagedChanges: countStagedChanges(statusLines),
      unstagedChanges: countUnstagedChanges(statusLines),
    }
  })

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
      Effect.all({
        linked: isLinkedToCentralEnv(fs, path, worktreePath, centralEnvPath),
        metadata: readWorktreeMetadata(worktreePath),
      }).pipe(Effect.map(({ linked, metadata }): Worktree => ({ path: worktreePath, linked, ...metadata }))),
    )
  })
