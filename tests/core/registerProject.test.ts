import { Command, FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { registerProject } from '../../src/core/registerProject.ts'
import { withProjectFixtures } from './fixtures.ts'

describe('registerProject', () => {
  it('creates a Central env file with 0600 permissions', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder })

        expect(project.name).toBe(path.basename(projectFolder))
        expect(yield* fs.exists(project.centralEnvFile)).toBe(true)
        expect((yield* fs.stat(project.centralEnvFile)).mode & 0o777).toBe(0o600)
        expect(yield* fs.readFileString(project.centralEnvFile)).toBe('')
      }),
    ))

  it('auto-imports an existing .env from the folder', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        yield* fs.writeFileString(path.join(projectFolder, '.env'), 'FOO=bar\n')

        const project = yield* registerProject({ folderPath: projectFolder })

        expect(yield* fs.readFileString(project.centralEnvFile)).toBe('FOO=bar\n')
      }),
    ))

  it('accepts a custom display name instead of the folder basename', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* registerProject({ folderPath: projectFolder, name: 'Custom Name' })
        expect(project.name).toBe('Custom Name')
      }),
    ))

  it('trims whitespace from a custom display name', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* registerProject({ folderPath: projectFolder, name: '  Custom Name  ' })
        expect(project.name).toBe('Custom Name')
      }),
    ))

  it('falls back to the folder basename when the given name is blank', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder, name: '   ' })
        expect(project.name).toBe(path.basename(projectFolder))
      }),
    ))

  it('registers a plain non-git folder', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* registerProject({ folderPath: projectFolder })
        expect(project.folderPath).toBe(projectFolder)
      }),
    ))

  it('registers a git repository folder', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        expect(yield* Command.exitCode(Command.make('git', '-C', projectFolder, 'init'))).toBe(0)

        const project = yield* registerProject({ folderPath: projectFolder })

        expect(yield* fs.exists(path.join(projectFolder, '.git'))).toBe(true)
        expect(project.folderPath).toBe(projectFolder)
      }),
    ))

  it('persists the new project to projects.json', () =>
    withProjectFixtures(({ home, projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder })

        const stored = JSON.parse(yield* fs.readFileString(path.join(home, 'projects.json')))
        expect(stored).toEqual([project])
      }),
    ))

  it('appends to existing projects without clobbering them', () =>
    withProjectFixtures(({ home, projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const other = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-project-' })

        const first = yield* registerProject({ folderPath: projectFolder })
        const second = yield* registerProject({ folderPath: other })

        const stored = JSON.parse(yield* fs.readFileString(path.join(home, 'projects.json')))
        expect(stored).toEqual([first, second])
      }),
    ))

  it('gives each registration a distinct Project ID and Central env file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const other = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-project-' })

        const first = yield* registerProject({ folderPath: projectFolder })
        const second = yield* registerProject({ folderPath: other })

        expect(first.id).not.toBe(second.id)
        expect(first.centralEnvFile).not.toBe(second.centralEnvFile)
      }),
    ))
})
