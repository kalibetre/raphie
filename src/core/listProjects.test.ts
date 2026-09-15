import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { listProjects } from './listProjects.ts'
import { registerProject } from './registerProject.ts'
import { withProjectFixtures } from './test/fixtures.ts'

describe('listProjects', () => {
  it('returns every registered project', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const other = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-project-' })

        const first = yield* registerProject({ folderPath: projectFolder })
        const second = yield* registerProject({ folderPath: other })

        expect(yield* listProjects).toEqual([first, second])
      }),
    ))

  it('returns an empty list when nothing is registered', () =>
    withProjectFixtures(() => Effect.gen(function* () {
      expect(yield* listProjects).toEqual([])
    })))
})
