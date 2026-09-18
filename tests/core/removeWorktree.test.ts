import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { discoverWorktrees } from '../../src/core/listWorktrees.ts'
import { registerProject } from '../../src/core/registerProject.ts'
import { forceRemoveWorktree, removeWorktree } from '../../src/core/removeWorktree.ts'
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

describe('removeWorktree', () => {
  it('removes a secondary Worktree and all of its files', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-worktree-' })
        const untrackedFile = path.join(worktreeFolder, 'local-only.txt')

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)).toBe(0)
        yield* fs.writeFileString(untrackedFile, 'remove me\n')

        expect(yield* removeWorktree(project, worktreeFolder)).toEqual({ removed: true })
        expect(yield* fs.exists(worktreeFolder)).toBe(false)
        expect(yield* discoverWorktrees(project)).toHaveLength(1)
      }),
    ))

  it('does not remove the Project’s main Worktree', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* createGitProject(projectFolder)

        expect(yield* removeWorktree(project, projectFolder)).toMatchObject({
          removed: false,
          error: { code: 'main-worktree' },
        })
        expect(yield* Command.exitCode(Command.make('git', '-C', projectFolder, 'status', '--porcelain'))).toBe(0)
      }),
    ))

  it('returns Git’s reason when a Worktree is locked', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-locked-worktree-' })

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'locked', worktreeFolder)).toBe(0)
        expect(yield* git(projectFolder, 'worktree', 'lock', worktreeFolder)).toBe(0)

        const result = yield* removeWorktree(project, worktreeFolder)
        expect(result.removed).toBe(false)
        if (result.removed) return
        expect(result.error.code).toBe('locked')
        expect(result.error.detail).toContain('cannot remove a locked working tree')
      }),
    ))

  it('force removes a locked Worktree folder and prunes Git metadata', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const project = yield* createGitProject(projectFolder)
        const worktreeFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-force-worktree-' })

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'force-delete', worktreeFolder)).toBe(0)
        expect(yield* git(projectFolder, 'worktree', 'lock', worktreeFolder)).toBe(0)

        expect(yield* forceRemoveWorktree(project, worktreeFolder)).toEqual({ removed: true })
        expect(yield* fs.exists(worktreeFolder)).toBe(false)
        expect(yield* discoverWorktrees(project)).toHaveLength(1)
      }),
    ))
})
