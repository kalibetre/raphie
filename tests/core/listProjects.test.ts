import { Command, FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { listProjects } from '../../src/core/listProjects.ts'
import { registerProject } from '../../src/core/registerProject.ts'
import { withProjectFixtures } from './fixtures.ts'

describe('listProjects', () => {
  it('returns every registered project', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const other = yield* fs.makeTempDirectoryScoped({ prefix: 'raphie-project-' })
        expect(yield* Command.exitCode(Command.make('git', '-C', projectFolder, 'init'))).toBe(0)

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
