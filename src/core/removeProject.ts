import { FileSystem, Path } from '@effect/platform'
import { Effect } from 'effect'
import * as ProjectsFile from './ProjectsFile.ts'

export type ProjectRemovalMode = 'copy' | 'remove'

const removeIfPresent = (fs: FileSystem.FileSystem, filePath: string) =>
  Effect.gen(function* () {
    // `exists` follows symlinks, so check readLink first. This lets us remove
    // a broken project .env symlink without touching its old target.
    const isSymlink = yield* fs.readLink(filePath).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    if (isSymlink || (yield* fs.exists(filePath))) {
      yield* fs.remove(filePath)
    }
  })

/**
 * Removes a Project and its Raphie-owned Central env data.
 *
 * In `copy` mode, the Central env becomes a regular `.env` in the project
 * folder before Raphie's Central copy is removed. In `remove` mode, the
 * project's `.env` is removed as well.
 */
export const removeProject = (projectId: string, mode: ProjectRemovalMode = 'copy') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projects = yield* ProjectsFile.readAll
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) return false

    const projectEnvFile = path.join(project.folderPath, '.env')
    if (mode === 'remove') {
      yield* removeIfPresent(fs, projectEnvFile)
    } else if ((yield* fs.exists(project.folderPath)) && (yield* fs.exists(project.centralEnvFile))) {
      // Remove a symlink first so the write creates a standalone file rather
      // than following the link back into Raphie's Central env.
      const centralEnv = yield* fs.readFileString(project.centralEnvFile)
      yield* removeIfPresent(fs, projectEnvFile)
      yield* fs.writeFileString(projectEnvFile, centralEnv, { mode: 0o600 })
      yield* fs.chmod(projectEnvFile, 0o600)
    }

    // Each Project gets its own generated directory under AppHome. Removing
    // that directory clears the Central env file and leaves no Raphie-owned
    // files behind.
    const centralDirectory = path.dirname(project.centralEnvFile)
    if (yield* fs.exists(centralDirectory)) {
      yield* fs.remove(centralDirectory, { recursive: true })
    }

    yield* ProjectsFile.writeAll(projects.filter((candidate) => candidate.id !== projectId))
    return true
  })
