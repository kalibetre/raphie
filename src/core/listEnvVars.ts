import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import { parseEnvVars } from './envVarFile.ts'

/** Reads and parses a Project's Central env file. Missing file reads as no EnvVars. */
export const listEnvVars = (centralEnvFile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(centralEnvFile)
    if (!exists) return []
    return parseEnvVars(yield* fs.readFileString(centralEnvFile))
  })
