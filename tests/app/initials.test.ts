import { describe, expect, it } from 'vitest'
import { initials } from '../../src/app/App.tsx'

describe('initials', () => {
  it('takes the first letter of the first two words for a multi-word name', () => {
    expect(initials('agent barn')).toBe('AB')
    expect(initials('reception-assistant')).toBe('RA')
  })

  it('takes the first two letters of a single-word name', () => {
    expect(initials('raphie')).toBe('RA')
  })
})
