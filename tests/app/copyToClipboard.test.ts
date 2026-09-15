import { afterEach, describe, expect, it } from 'vitest'
import { copyToClipboard } from '../../src/app/utils/clipboard.ts'

describe('copyToClipboard', () => {
  const originalBun = (globalThis as { Bun?: unknown }).Bun

  afterEach(() => {
    ;(globalThis as { Bun?: unknown }).Bun = originalBun
  })

  it('does nothing when not running under Bun', async () => {
    delete (globalThis as { Bun?: unknown }).Bun

    await expect(copyToClipboard('secret')).resolves.toBeUndefined()
  })

  it('shells the value out to pbcopy via Bun.$', async () => {
    const calls: string[] = []
    ;(globalThis as { Bun?: unknown }).Bun = {
      $: (_strings: TemplateStringsArray, value: string) => {
        calls.push(value)
        const promise = Promise.resolve()
        return Object.assign(promise, { quiet: () => promise })
      },
    }

    await copyToClipboard('supersecret')

    expect(calls).toEqual(['supersecret'])
  })

  it('swallows a clipboard failure instead of throwing', async () => {
    ;(globalThis as { Bun?: unknown }).Bun = {
      $: () => ({ quiet: () => Promise.reject(new Error('pbcopy unavailable')) }),
    }

    await expect(copyToClipboard('secret')).resolves.toBeUndefined()
  })
})
