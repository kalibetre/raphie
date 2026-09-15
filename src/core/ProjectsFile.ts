import { FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import type { Project } from './Domain.ts'
import { AppHome } from './AppHome.ts'

/** The one JSON file at `<AppHome>/projects.json` — every registered Project. */

const path_ = Effect.gen(function* () {
  const path = yield* Path.Path
  const home = yield* AppHome
  return path.join(home, 'projects.json')
})

export const readAll = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = yield* path_
  const exists = yield* fs.exists(file)
  if (!exists) return []
  const content = yield* fs.readFileString(file)
  return JSON.parse(content) as Project[]
})

export const writeAll = (projects: readonly Project[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* path_
    yield* fs.writeFileString(file, JSON.stringify(projects, null, 2))
  })

export const append = (project: Project) =>
  Effect.gen(function* () {
    const projects = yield* readAll
    yield* writeAll([...projects, project])
  })
