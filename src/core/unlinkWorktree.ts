import { FileSystem, Path } from '@effect/platform'
import { Data, Effect } from 'effect'
import type { Project } from './Domain.ts'
import { isLinkedToCentralEnv, removeIfPresent } from './worktreeEnvFile.ts'

export type WorktreeUnlinkMode = 'copy' | 'remove'

export class WorktreeNotLinkedError extends Data.TaggedError('WorktreeNotLinkedError')<{
  readonly worktreePath: string
  readonly envFilePath: string
  readonly centralEnvFile: string
}> {}

export class InvalidWorktreeUnlinkModeError extends Data.TaggedError('InvalidWorktreeUnlinkModeError')<{
  readonly mode: string
}> {}

/**
 * Unlinks a Worktree's `.env` from its Project's Central env file.
 *
 * The caller must choose whether the Worktree keeps a standalone copy of the
 * current Central values or loses `.env` entirely. Reading the Central file
 * happens before removing the symlink so the copy mode never follows a link
 * back into the file it is replacing.
 */
export const unlinkWorktree = (project: Project, worktreePath: string, mode: WorktreeUnlinkMode) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const worktreeEnvFile = path.join(worktreePath, '.env')

    if (mode !== 'copy' && mode !== 'remove') {
      return yield* Effect.fail(new InvalidWorktreeUnlinkModeError({ mode: String(mode) }))
    }
    if (!(yield* isLinkedToCentralEnv(fs, worktreeEnvFile, project.centralEnvFile))) {
      return yield* Effect.fail(
        new WorktreeNotLinkedError({
          worktreePath,
          envFilePath: worktreeEnvFile,
          centralEnvFile: project.centralEnvFile,
        }),
      )
    }

    if (mode === 'remove') {
      yield* removeIfPresent(fs, worktreeEnvFile)
      return
    }

    const centralValues = yield* fs.readFileString(project.centralEnvFile)
    yield* removeIfPresent(fs, worktreeEnvFile)
    yield* fs.writeFileString(worktreeEnvFile, centralValues, { mode: 0o600 })
    yield* fs.chmod(worktreeEnvFile, 0o600)
  })
