import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { linkWorktree } from '../../src/core/linkWorktree.ts'
import { registerProject } from '../../src/core/registerProject.ts'
import {
  InvalidWorktreeUnlinkModeError,
  unlinkWorktree,
  WorktreeNotLinkedError,
} from '../../src/core/unlinkWorktree.ts'
import { withProjectFixtures } from './fixtures.ts'

const git = (folderPath: string, ...args: string[]) => Command.exitCode(Command.make('git', '-C', folderPath, ...args))

const createGitProject = (projectFolder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    expect(yield* git(projectFolder, 'init')).toBe(0)
    expect(yield* git(projectFolder, 'config', 'user.email', 'raphie-tests@example.com')).toBe(0)
    expect(yield* git(projectFolder, 'config', 'user.name', 'Raphie Tests')).toBe(0)
    yield* fs.writeFileString(path.join(projectFolder, 'README.md'), 'initial\n')
    expect(yield* git(projectFolder, 'add', 'README.md')).toBe(0)
    expect(yield* git(projectFolder, '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')).toBe(0)

    return yield* registerProject({ folderPath: projectFolder })
  })

describe('unlinkWorktree', () => {
  it('replaces a linked Worktree .env with a standalone copy of the Central values', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-unlink-worktree-' })
        const worktreeEnvFile = path.join(worktreeFolder, '.env')
        const centralValues = 'API_URL=https://example.test\nTOKEN=keep-me\n'

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)).toBe(0)
        yield* fs.writeFileString(project.centralEnvFile, centralValues)
        yield* linkWorktree(project, worktreeFolder)

        yield* unlinkWorktree(project, worktreeFolder, 'copy')
        expect((yield* fs.readLink(worktreeEnvFile).pipe(Effect.either))._tag).toBe('Left')
        expect(yield* fs.readFileString(worktreeEnvFile)).toBe(centralValues)
        expect(yield* fs.readFileString(project.centralEnvFile)).toBe(centralValues)
        yield* fs.remove(worktreeFolder, { recursive: true })
      }),
    ))

  it('removes a linked Worktree .env without removing the Central values', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-unlink-worktree-' })
        const worktreeEnvFile = path.join(worktreeFolder, '.env')
        const centralValues = 'REMOVE_ME=1\n'

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'remove-env', worktreeFolder)).toBe(0)
        yield* fs.writeFileString(project.centralEnvFile, centralValues)
        yield* linkWorktree(project, worktreeFolder)

        yield* unlinkWorktree(project, worktreeFolder, 'remove')
        expect((yield* fs.readLink(worktreeEnvFile).pipe(Effect.either))._tag).toBe('Left')
        expect(yield* fs.exists(worktreeEnvFile)).toBe(false)
        expect(yield* fs.readFileString(project.centralEnvFile)).toBe(centralValues)
        yield* fs.remove(worktreeFolder, { recursive: true })
      }),
    ))

  it('does not delete a real .env that is not linked to the Central env file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeEnvFile = path.join(projectFolder, '.env')
        const localValues = 'LOCAL_ONLY=yes\n'

        yield* fs.writeFileString(project.centralEnvFile, 'CENTRAL=yes\n')
        yield* fs.writeFileString(worktreeEnvFile, localValues)

        const result = yield* Effect.either(unlinkWorktree(project, projectFolder, 'remove'))
        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') expect(result.left).toBeInstanceOf(WorktreeNotLinkedError)
        expect(yield* fs.readFileString(worktreeEnvFile)).toBe(localValues)
      }),
    ))

  it('rejects a missing runtime mode instead of silently choosing copy mode', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-unlink-worktree-' })
        const worktreeEnvFile = path.join(worktreeFolder, '.env')

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'invalid-mode', worktreeFolder)).toBe(0)
        yield* fs.writeFileString(project.centralEnvFile, 'CENTRAL=yes\n')
        yield* linkWorktree(project, worktreeFolder)

        const result = yield* Effect.either(unlinkWorktree(project, worktreeFolder, undefined as never))
        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') expect(result.left).toBeInstanceOf(InvalidWorktreeUnlinkModeError)
        expect(yield* fs.readLink(worktreeEnvFile)).toBe(project.centralEnvFile)
        yield* fs.remove(worktreeFolder, { recursive: true })
      }),
    ))
})
