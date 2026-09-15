import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { AppHome, AppHomeLive } from '../../src/core/AppHome.ts'

describe('AppHomeLive', () => {
  const originalRaphieHome = process.env.RAPHIE_HOME

  afterEach(() => {
    if (originalRaphieHome === undefined) delete process.env.RAPHIE_HOME
    else process.env.RAPHIE_HOME = originalRaphieHome
  })

  it('uses RAPHIE_HOME when set', async () => {
    process.env.RAPHIE_HOME = '/tmp/custom-raphie-home'

    const home = await Effect.runPromise(Effect.provide(AppHome, AppHomeLive))

    expect(home).toBe('/tmp/custom-raphie-home')
  })

  it('falls back to ~/.config/raphie when RAPHIE_HOME is unset', async () => {
    delete process.env.RAPHIE_HOME

    const home = await Effect.runPromise(Effect.provide(AppHome, AppHomeLive))

    expect(home).toBe(`${process.env.HOME}/.config/raphie`)
  })

  it('re-reads the env on every use, not just once at import time', async () => {
    delete process.env.RAPHIE_HOME
    const before = await Effect.runPromise(Effect.provide(AppHome, AppHomeLive))

    process.env.RAPHIE_HOME = '/tmp/second-raphie-home'
    const after = await Effect.runPromise(Effect.provide(AppHome, AppHomeLive))

    expect(before).not.toBe(after)
    expect(after).toBe('/tmp/second-raphie-home')
  })
})
