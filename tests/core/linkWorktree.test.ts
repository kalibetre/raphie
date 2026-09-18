import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { LinkWorktreeConflictError, linkWorktree } from '../../src/core/index.ts'
import { registerProject } from '../../src/core/registerProject.ts'
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

const readLinkResult = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readLink(filePath).pipe(Effect.either)
  })

describe('linkWorktree', () => {
  it('links a Worktree with no existing .env to the Central env file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeEnvFile = path.join(projectFolder, '.env')

        const result = yield* linkWorktree(project, projectFolder)

        expect(result).toEqual({ linked: true, backupPath: null })
        expect(yield* fs.readLink(worktreeEnvFile)).toBe(project.centralEnvFile)
        expect(yield* fs.realPath(worktreeEnvFile)).toBe(yield* fs.realPath(project.centralEnvFile))
      }),
    ))

  it('refuses a real .env without touching it', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeEnvFile = path.join(projectFolder, '.env')
        const original = 'LOCAL_ONLY=yes\n'
        yield* fs.writeFileString(worktreeEnvFile, original)

        const result = yield* Effect.either(linkWorktree(project, projectFolder))

        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(LinkWorktreeConflictError)
          if (result.left instanceof LinkWorktreeConflictError) {
            expect(result.left.envFilePath).toBe(worktreeEnvFile)
          }
        }
        expect(yield* fs.readFileString(worktreeEnvFile)).toBe(original)
        expect((yield* readLinkResult(worktreeEnvFile))._tag).toBe('Left')
      }),
    ))

  it('backs up a real .env before force-linking the Worktree', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* createGitProject(projectFolder)
        const worktreeEnvFile = path.join(projectFolder, '.env')
        const original = 'LOCAL_ONLY=yes\nKEEP_ME=untouched\n'
        yield* fs.writeFileString(worktreeEnvFile, original)

        const result = yield* linkWorktree(project, projectFolder, { force: true })

        expect(result.linked).toBe(true)
        expect(result.backupPath).not.toBeNull()
        expect(yield* fs.readLink(worktreeEnvFile)).toBe(project.centralEnvFile)
        expect(yield* fs.realPath(worktreeEnvFile)).toBe(yield* fs.realPath(project.centralEnvFile))
        expect(yield* fs.readFileString(result.backupPath!)).toBe(original)
        expect((yield* readLinkResult(result.backupPath!))._tag).toBe('Left')
      }),
    ))
})
