import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { listWorktrees } from '../../src/core/listWorktrees.ts'
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

        const project = yield* registerProject({ folderPath: projectFolder })
        yield* fs.symlink(project.centralEnvFile, path.join(projectFolder, '.env'))

        expect(yield* git(projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)).toBe(0)
        yield* fs.writeFileString(path.join(worktreeFolder, '.env'), 'LOCAL_ONLY=yes\n')

        const worktrees = yield* listWorktrees(project)
        const mainPath = yield* fs.realPath(projectFolder)
        const additionalPath = yield* fs.realPath(worktreeFolder)
        expect(worktrees).toEqual([
          { path: mainPath, linked: true },
          { path: additionalPath, linked: false },
        ])

        yield* fs.remove(path.join(projectFolder, '.env'))
        yield* fs.writeFileString(path.join(projectFolder, '.env'), 'LOCAL_ONLY=yes\n')
        expect((yield* listWorktrees(project))[0]).toEqual({ path: mainPath, linked: false })
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
