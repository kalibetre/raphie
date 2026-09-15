import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Project } from '../../src/core/Domain.ts'
import * as ProjectsFile from '../../src/core/ProjectsFile.ts'
import { withProjectFixtures } from './fixtures.ts'

const projectFixture = (overrides: Partial<Project> = {}): Project => ({
  id: 'abcd1234',
  name: 'demo',
  folderPath: '/tmp/demo',
  centralEnvFile: '/tmp/central/demo/.env',
  ...overrides,
})

describe('ProjectsFile', () => {
  it('readAll returns an empty array when projects.json does not exist', () =>
    withProjectFixtures(() =>
      Effect.gen(function* () {
        expect(yield* ProjectsFile.readAll).toEqual([])
      }),
    ))

  it('append creates projects.json when it does not exist yet', () =>
    withProjectFixtures(({ home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const project = projectFixture()

        yield* ProjectsFile.append(project)

        expect(yield* fs.exists(`${home}/projects.json`)).toBe(true)
        expect(yield* ProjectsFile.readAll).toEqual([project])
      }),
    ))

  it('append preserves existing entries and adds the new one at the end', () =>
    withProjectFixtures(() =>
      Effect.gen(function* () {
        const first = projectFixture({ id: 'a1', name: 'first' })
        const second = projectFixture({ id: 'a2', name: 'second' })

        yield* ProjectsFile.append(first)
        yield* ProjectsFile.append(second)

        expect(yield* ProjectsFile.readAll).toEqual([first, second])
      }),
    ))
})
