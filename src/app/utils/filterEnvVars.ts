import type { EnvVar } from '../../core/index.ts'

export interface IndexedEnvVar {
  readonly envVar: EnvVar
  readonly index: number
}

export const filterEnvVars = (envVars: readonly EnvVar[], query: string): IndexedEnvVar[] => {
  const needle = query.trim().toLowerCase()

  return envVars.flatMap((envVar, index) => {
    if (!needle || envVar.key.toLowerCase().includes(needle) || envVar.value.toLowerCase().includes(needle)) {
      return [{ envVar, index }]
    }
    return []
  })
}
