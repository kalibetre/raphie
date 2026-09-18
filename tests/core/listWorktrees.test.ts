import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { countLinkedWorktrees } from '../../src/core/index.ts'
import { discoverWorktrees, listWorktrees } from '../../src/core/listWorktrees.ts'
import { registerProject } from '../../src/core/registerProject.ts'
import { withProjectFixtures } from './fixtures.ts'

const git = (folderPath: string, ...args: string[]) => Command.exitCode(Command.make('git', '-C', folderPath, ...args))

describe('listWorktrees', () => {
  it('lists the main Worktree and additional Worktrees with live Central env link status', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const worktreeFolder = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-worktree-' })

        expect(yield* git(projectFolder, 'init')).toBe(0)
        expect(yield* git(projectFolder, 'config', 'user.email', 'raphie-tests@example.com')).toBe(0)
        expect(yield* git(projectFolder, 'config', 'user.name', 'Raphie Tests')).toBe(0)
        yield* fs.writeFileString(path.join(projectFolder, 'README.md'), 'initial\n')
        expect(yield* git(projectFolder, 'add', 'README.md')).toBe(0)
        // The developer environment may globally require SSH commit signing;
        // this integration test only needs a real commit for worktree setup.
        expect(yield* git(projectFolder, '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')).toBe(0)
        expect(yield* git(projectFolder, 'branch', '-M', 'main')).toBe(0)

        const project = yield* registerProject({ folderPath: projectFolder })
        yield* fs.symlink(project.centralEnvFile, path.join(projectFolder, '.env'))

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)).toBe(0)
        const mainPath = yield* fs.realPath(projectFolder)
        const additionalPath = yield* fs.realPath(worktreeFolder)
        expect(yield* discoverWorktrees(project)).toEqual([
          { path: mainPath, linked: true, hasEnvFile: true, metadata: null },
          { path: additionalPath, linked: false, hasEnvFile: false, metadata: null },
        ])
        expect(yield* countLinkedWorktrees(project)).toBe(1)
        yield* fs.writeFileString(path.join(worktreeFolder, '.env'), 'LOCAL_ONLY=yes\n')
        yield* fs.writeFileString(path.join(projectFolder, 'README.md'), 'changed\n')
        yield* fs.writeFileString(path.join(projectFolder, 'staged.txt'), 'staged\n')
        expect(yield* git(projectFolder, 'add', 'staged.txt')).toBe(0)

        const discoveredWorktrees = yield* discoverWorktrees(project)
        expect(discoveredWorktrees).toEqual([
          { path: mainPath, linked: true, hasEnvFile: true, metadata: null },
          { path: additionalPath, linked: false, hasEnvFile: true, metadata: null },
        ])

        const worktrees = yield* listWorktrees(project)
        expect(worktrees[0]).toMatchObject({
          path: mainPath,
          linked: true,
          hasEnvFile: true,
          metadata: {
            branch: 'main',
            stagedChanges: 1,
            unstagedChanges: 2,
            size: expect.any(Number),
            lastCommit: {
              subject: 'initial',
              date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            },
          },
        })
        expect(worktrees[0]!.metadata!.size).toBeGreaterThan(0)
        expect(worktrees[1]).toMatchObject({
          path: additionalPath,
          linked: false,
          hasEnvFile: true,
          metadata: {
            branch: 'feature',
            lastCommit: { subject: 'initial' },
          },
        })

        yield* fs.remove(path.join(projectFolder, '.env'))
        yield* fs.writeFileString(path.join(projectFolder, '.env'), 'LOCAL_ONLY=yes\n')
        expect((yield* listWorktrees(project))[0]).toMatchObject({
          path: mainPath,
          linked: false,
          hasEnvFile: true,
        })
      }),
    ))

  it('keeps an unlinked symlink visible as an existing env file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const worktreeFolder = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-worktree-' })
        const legacyEnvDirectory = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-legacy-env-' })

        expect(yield* git(projectFolder, 'init')).toBe(0)
        expect(yield* git(projectFolder, 'config', 'user.email', 'raphie-tests@example.com')).toBe(0)
        expect(yield* git(projectFolder, 'config', 'user.name', 'Raphie Tests')).toBe(0)
        yield* fs.writeFileString(path.join(projectFolder, 'README.md'), 'initial\n')
        expect(yield* git(projectFolder, 'add', 'README.md')).toBe(0)
        expect(yield* git(projectFolder, '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')).toBe(0)
        expect(yield* git(projectFolder, 'branch', '-M', 'main')).toBe(0)

        const project = yield* registerProject({ folderPath: projectFolder })
        yield* fs.symlink(project.centralEnvFile, path.join(projectFolder, '.env'))
        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)).toBe(0)

        const legacyEnvFile = path.join(legacyEnvDirectory, '.env')
        yield* fs.writeFileString(legacyEnvFile, 'LEGACY=yes\n')
        yield* fs.symlink(legacyEnvFile, path.join(worktreeFolder, '.env'))

        const mainPath = yield* fs.realPath(projectFolder)
        const additionalPath = yield* fs.realPath(worktreeFolder)
        expect(yield* discoverWorktrees(project)).toEqual([
          { path: mainPath, linked: true, hasEnvFile: true, metadata: null },
          { path: additionalPath, linked: false, hasEnvFile: true, metadata: null },
        ])
      }),
    ))

  it('returns no Worktrees for a non-git Project', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* registerProject({ folderPath: projectFolder })

        expect(yield* listWorktrees(project)).toEqual([])
      }),
    ))
})
