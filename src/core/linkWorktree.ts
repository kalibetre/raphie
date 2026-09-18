import { FileSystem, Path } from '@effect/platform'
import { Data, Effect } from 'effect'
import type { Project } from './Domain.ts'
import { isLinkedToCentralEnv, pathExists } from './worktreeEnvFile.ts'

export class LinkWorktreeConflictError extends Data.TaggedError('LinkWorktreeConflictError')<{
  readonly worktreePath: string
  readonly envFilePath: string
  readonly centralEnvFile: string
}> {}

export interface LinkWorktreeOptions {
  /** Replace an existing `.env` after preserving it as a backup. */
  readonly force?: boolean
}

export interface LinkWorktreeResult {
  readonly linked: true
  /** The original `.env` path after a forced link, or null when no backup was needed. */
  readonly backupPath: string | null
}

type LinkWorktreeOptionsInput = LinkWorktreeOptions | boolean

const nextBackupPath = (fs: FileSystem.FileSystem, path: Path.Path, envFilePath: string) =>
  Effect.gen(function* () {
    const basePath = `${envFilePath}.backup`
    let backupPath = basePath
    let suffix = 0
    while (yield* pathExists(fs, backupPath)) {
      suffix += 1
      backupPath = path.join(path.dirname(basePath), `.env.backup.${suffix}`)
    }
    return backupPath
  })

const forceOption = (options: LinkWorktreeOptionsInput) =>
  typeof options === 'boolean' ? options : options.force === true

/**
 * Links a Worktree's `.env` to its Project's Central env file.
 *
 * An existing `.env` is a conflict unless it is already the requested link.
 * Forced linking renames that path aside before creating the symlink, so the
 * existing file is recoverable and the Central env remains the only source of
 * truth for the Worktree.
 */
export const linkWorktree = (
  project: Project,
  worktreePath: string,
  options: LinkWorktreeOptionsInput = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const worktreeEnvFile = path.join(worktreePath, '.env')

    if (yield* isLinkedToCentralEnv(fs, worktreeEnvFile, project.centralEnvFile)) {
      return { linked: true as const, backupPath: null }
    }

    const existing = yield* pathExists(fs, worktreeEnvFile)
    if (existing && !forceOption(options)) {
      return yield* Effect.fail(
        new LinkWorktreeConflictError({
          worktreePath,
          envFilePath: worktreeEnvFile,
          centralEnvFile: project.centralEnvFile,
        }),
      )
    }

    let backupPath: string | null = null
    if (existing) {
      backupPath = yield* nextBackupPath(fs, path, worktreeEnvFile)
      yield* fs.rename(worktreeEnvFile, backupPath)
    }

    yield* fs.symlink(project.centralEnvFile, worktreeEnvFile)
    return { linked: true as const, backupPath }
  })

/** Force-links a Worktree while preserving any existing `.env` as a backup. */
export const forceLinkWorktree = (project: Project, worktreePath: string) =>
  linkWorktree(project, worktreePath, { force: true })
