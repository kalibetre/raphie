import { FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import type { Project } from './Domain.ts'
import { AppHome } from './AppHome.ts'
import { generateProjectId } from './ids.ts'
import * as ProjectsFile from './ProjectsFile.ts'

export const registerProject = (input: {
  readonly folderPath: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const home = yield* AppHome

    const id = generateProjectId()
    const name = path.basename(input.folderPath)
    const centralEnvFile = path.join(home, id, '.env')

    yield* fs.makeDirectory(path.dirname(centralEnvFile), { recursive: true })

    // Auto-import: a folder's existing `.env` (if any) seeds the new Central env file.
    const existingEnvFile = path.join(input.folderPath, '.env')
    const imported = yield* fs
      .exists(existingEnvFile)
      .pipe(Effect.flatMap((exists) => (exists ? fs.readFileString(existingEnvFile) : Effect.succeed(''))))
    yield* fs.writeFileString(centralEnvFile, imported, { mode: 0o600 })

    const project: Project = { id, name, folderPath: input.folderPath, centralEnvFile }
    yield* ProjectsFile.append(project)

    return project
  })
