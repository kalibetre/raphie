import { describe, expect, it } from 'vitest'
import { generateProjectId } from '../../src/core/ids.ts'

describe('generateProjectId', () => {
  it('returns an 8-character id', () => {
    expect(generateProjectId()).toHaveLength(8)
  })

  it('generates unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateProjectId()))
    expect(ids.size).toBe(1000)
  })
})
