import { describe, expect, it } from 'vitest'
import { filterEnvVars } from '../../src/app/utils/filterEnvVars.ts'

describe('filterEnvVars', () => {
  const envVars = [
    { key: 'DATABASE_URL', value: 'postgres://localhost' },
    { key: 'API_TOKEN', value: 'secret-token' },
    { key: 'APP_PORT', value: '3000' },
  ]

  it('matches keys case-insensitively and keeps source indices', () => {
    expect(filterEnvVars(envVars, 'api')).toEqual([{ envVar: envVars[1], index: 1 }])
  })

  it('matches values case-insensitively', () => {
    expect(filterEnvVars(envVars, 'POSTGRES')).toEqual([{ envVar: envVars[0], index: 0 }])
  })

  it('returns every EnvVar for a blank query and no results for an unknown query', () => {
    expect(filterEnvVars(envVars, '  ')).toHaveLength(3)
    expect(filterEnvVars(envVars, 'missing')).toEqual([])
  })
})
