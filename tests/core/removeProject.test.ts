import { FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { listProjects } from '../../src/core/listProjects.ts'
import { registerProject } from '../../src/core/registerProject.ts'
import { removeProject } from '../../src/core/removeProject.ts'
import { withProjectFixtures } from './fixtures.ts'

describe('removeProject', () => {
  it('copies the Central env into the project and removes Raphie-owned files by default', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder })
        const projectEnvFile = path.join(projectFolder, '.env')
        const centralDirectory = path.dirname(project.centralEnvFile)

        yield* fs.writeFileString(project.centralEnvFile, 'FROM_CENTRAL=1\n')
        expect(yield* removeProject(project.id)).toBe(true)

        expect(yield* fs.readFileString(projectEnvFile)).toBe('FROM_CENTRAL=1\n')
        expect(yield* fs.exists(project.centralEnvFile)).toBe(false)
        expect(yield* fs.exists(centralDirectory)).toBe(false)
        expect(yield* listProjects).toEqual([])
      }),
    ))

  it('replaces a project .env symlink with a standalone copy', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder })
        const projectEnvFile = path.join(projectFolder, '.env')

        yield* fs.writeFileString(project.centralEnvFile, 'LINKED=before-removal\n')
        yield* fs.symlink(project.centralEnvFile, projectEnvFile)

        expect(yield* removeProject(project.id)).toBe(true)
        expect(yield* fs.readFileString(projectEnvFile)).toBe('LINKED=before-removal\n')
        expect(yield* fs.exists(project.centralEnvFile)).toBe(false)
      }),
    ))

  it('removes the project .env when requested', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const project = yield* registerProject({ folderPath: projectFolder })
        const projectEnvFile = path.join(projectFolder, '.env')

        yield* fs.writeFileString(project.centralEnvFile, 'REMOVE_ME=1\n')
        yield* fs.writeFileString(projectEnvFile, 'LOCAL=1\n')

        expect(yield* removeProject(project.id, 'remove')).toBe(true)
        expect(yield* fs.exists(projectEnvFile)).toBe(false)
        expect(yield* fs.exists(project.centralEnvFile)).toBe(false)
        expect(yield* listProjects).toEqual([])
      }),
    ))

  it('returns false when the Project is not registered', () =>
    withProjectFixtures(() =>
      Effect.gen(function* () {
        expect(yield* removeProject('missing-project')).toBe(false)
      }),
    ))

  it('succeeds in remove mode even when the project has no .env yet', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const project = yield* registerProject({ folderPath: projectFolder })
        // No .env written to the project folder at all — removeIfPresent's
        // "not a symlink and doesn't exist" branch.
        expect(yield* removeProject(project.id, 'remove')).toBe(true)
        expect(yield* listProjects).toEqual([])
      }),
    ))

  it('skips copying into a Project folder that no longer exists', () =>
    withProjectFixtures(() =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        // Unscoped, not the fixture's own `projectFolder` — this one gets
        // deleted mid-test, and the fixture's scope finalizer would error
        // trying to clean up a directory that's already gone.
        const disappearingFolder = yield* fs.makeTempDirectory({ prefix: 'raphie-project-' })
        const project = yield* registerProject({ folderPath: disappearingFolder })
        yield* fs.writeFileString(project.centralEnvFile, 'FROM_CENTRAL=1\n')
        yield* fs.remove(disappearingFolder, { recursive: true })

        expect(yield* removeProject(project.id)).toBe(true)
        expect(yield* fs.exists(project.centralEnvFile)).toBe(false)
        expect(yield* listProjects).toEqual([])
      }),
    ))
})
