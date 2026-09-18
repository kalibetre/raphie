import { Command, FileSystem } from '@effect/platform'
import * as Chunk from 'effect/Chunk'
import { Effect, Stream } from 'effect'
import type { Project } from './Domain.ts'

const parseWorktreePaths = (lines: readonly string[]) =>
  lines.filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))

const canonicalPath = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.realPath(filePath).pipe(
    Effect.map((resolved) => resolved as string | null),
    Effect.catchAll(() => Effect.succeed(null)),
  )

export type WorktreeRemovalFailureCode =
  | 'project-unavailable'
  | 'worktree-unavailable'
  | 'main-worktree'
  | 'not-registered'
  | 'git-list-failed'
  | 'locked'
  | 'git-rejected'
  | 'unknown'

export interface WorktreeRemovalFailure {
  readonly code: WorktreeRemovalFailureCode
  readonly message: string
  /** Raw Git or filesystem detail, when one was available. */
  readonly detail: string | null
}

export type RemoveWorktreeResult =
  | { readonly removed: true }
  | { readonly removed: false; readonly error: WorktreeRemovalFailure }

const makeFailure = (
  code: WorktreeRemovalFailureCode,
  message: string,
  detail: string | null = null,
): WorktreeRemovalFailure => ({ code, message, detail })

const failed = (
  code: WorktreeRemovalFailureCode,
  message: string,
  detail: string | null = null,
): RemoveWorktreeResult => ({ removed: false, error: makeFailure(code, message, detail) })

const describeUnknownError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const decodeChunks = (chunks: Chunk.Chunk<Uint8Array>) => {
  const values = Chunk.toArray(chunks)
  const bytes = new Uint8Array(values.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of values) {
    bytes.set(value, offset)
    offset += value.length
  }
  return new TextDecoder().decode(bytes).trim()
}

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs Git while retaining both streams so a rejected operation is actionable in the UI. */
const runCommand = (command: Command.Command) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* Command.start(command)
      const [stdout, stderr] = yield* Effect.all(
        [
          Stream.runCollect(process.stdout).pipe(Effect.map(decodeChunks)),
          Stream.runCollect(process.stderr).pipe(Effect.map(decodeChunks)),
        ],
        { concurrency: 'unbounded' },
      )
      const exitCode = yield* process.exitCode
      return { exitCode: Number(exitCode), stdout, stderr }
    }),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({ exitCode: -1, stdout: '', stderr: describeUnknownError(error) }),
    ),
  )

const commandDetail = (result: Pick<CommandResult, 'stdout' | 'stderr'>) =>
  [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || null

const classifyGitFailure = (detail: string | null): WorktreeRemovalFailure => {
  const normalized = detail?.toLowerCase() ?? ''
  if (normalized.includes('locked working tree')) {
    return makeFailure(
      'locked',
      'Git has this Worktree marked as locked. Unlock it before deleting it.',
      detail,
    )
  }
  if (normalized.includes('not a working tree') || normalized.includes('is not a worktree')) {
    return makeFailure(
      'not-registered',
      'Git no longer recognizes this folder as a Worktree. It may already have been removed.',
      detail,
    )
  }
  return makeFailure('git-rejected', 'Git rejected the Worktree deletion.', detail)
}

/**
 * Removes a secondary Worktree and its files from a Project.
 *
 * Git's `--force` flag is intentional: this action is explicitly destructive
 * and the UI confirms that local changes and untracked files will be removed.
 * The main Worktree and paths Git does not report are rejected before Git is
 * invoked. Failures retain their reason so the UI can explain them.
 */
export const removeWorktree = (project: Project, worktreePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const requestedPath = yield* canonicalPath(fs, worktreePath)
    const projectPath = yield* canonicalPath(fs, project.folderPath)
    if (projectPath === null) {
      return failed('project-unavailable', 'The Project folder is missing or cannot be accessed.')
    }
    if (requestedPath === null) {
      return failed('worktree-unavailable', 'The Worktree folder is missing or cannot be accessed.')
    }
    if (requestedPath === projectPath) {
      return failed('main-worktree', 'The main Worktree cannot be deleted.')
    }

    const listResult = yield* runCommand(Command.make('git', '-C', projectPath, 'worktree', 'list', '--porcelain'))
    const listDetail = commandDetail(listResult)
    if (listResult.exitCode !== 0) {
      return failed('git-list-failed', 'Git could not inspect the Project’s Worktrees.', listDetail)
    }

    const listedPaths = yield* Effect.forEach(parseWorktreePaths(listResult.stdout.split(/\r?\n/)), (path) =>
      canonicalPath(fs, path),
      { concurrency: 'unbounded' },
    )
    if (!listedPaths.includes(requestedPath)) {
      return failed(
        'not-registered',
        'Git no longer recognizes this folder as a Worktree. It may already have been removed.',
        'The path was not returned by git worktree list --porcelain.',
      )
    }

    const removeResult = yield* runCommand(
      Command.make('git', '-C', projectPath, 'worktree', 'remove', '--force', requestedPath),
    )
    if (removeResult.exitCode !== 0) {
      const failure = classifyGitFailure(commandDetail(removeResult))
      return { removed: false as const, error: failure }
    }
    return { removed: true as const }
  })
