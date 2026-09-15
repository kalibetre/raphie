import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import type { EnvVar } from './Domain.ts'

const parse = (content: string): EnvVar[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .flatMap((line) => {
      const eq = line.indexOf('=')
      if (eq === -1) return []
      const key = line.slice(0, eq).trim()
      const rawValue = line.slice(eq + 1).trim()
      const quoted = /^(["']).*\1$/.test(rawValue)
      const value = quoted ? rawValue.slice(1, -1) : rawValue
      return [{ key, value }]
    })

/** Reads and parses a Project's Central env file. Missing file reads as no EnvVars. */
export const listEnvVars = (centralEnvFile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(centralEnvFile)
    if (!exists) return []
    return parse(yield* fs.readFileString(centralEnvFile))
  })
