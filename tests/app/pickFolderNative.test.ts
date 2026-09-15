import { afterEach, describe, expect, it } from 'vitest'
import { pickFolderNative } from '../../src/app/utils/pickFolder.ts'

// vitest's test workers run without a `Bun` global (confirmed while building
// AppHome — see its comment), so pickFolderNative's own `typeof Bun ===
// 'undefined'` guard is exercised for free here. The other two branches
// (a real osascript call succeeding or being cancelled) are stubbed onto a
// fake global, since neither can run headless in CI.
describe('pickFolderNative', () => {
  const originalBun = (globalThis as { Bun?: unknown }).Bun

  afterEach(() => {
    ;(globalThis as { Bun?: unknown }).Bun = originalBun
  })

  it('returns null when not running under Bun', async () => {
    delete (globalThis as { Bun?: unknown }).Bun

    expect(await pickFolderNative()).toBeNull()
  })

  it('returns the chosen folder path, trimmed', async () => {
    ;(globalThis as { Bun?: unknown }).Bun = {
      $: () => ({ text: () => Promise.resolve('/Users/demo/Projects/raphie\n') }),
    }

    expect(await pickFolderNative()).toBe('/Users/demo/Projects/raphie')
  })

  it('returns null when the picker is cancelled', async () => {
    ;(globalThis as { Bun?: unknown }).Bun = {
      $: () => ({ text: () => Promise.reject(new Error('user cancelled')) }),
    }

    expect(await pickFolderNative()).toBeNull()
  })

  it('returns null for a blank result instead of an empty string', async () => {
    ;(globalThis as { Bun?: unknown }).Bun = {
      $: () => ({ text: () => Promise.resolve('   \n') }),
    }

    expect(await pickFolderNative()).toBeNull()
  })
})
