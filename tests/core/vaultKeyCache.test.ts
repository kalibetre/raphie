import { describe, expect, it } from 'vitest'
import { makeKeychainKeyCache, type SecretStore } from '../../src/core/vaultKeyCache.ts'

const makeFakeKeychain = () => {
  const slot: { value: string | null } = { value: null }
  const store: SecretStore = {
    get: async () => slot.value,
    set: async (value) => {
      slot.value = value
    },
    delete: async () => {
      slot.value = null
    },
  }
  return { slot, store }
}

const key = new Uint8Array([1, 2, 3, 250, 251, 252])

describe('keychain key cache', () => {
  it('round-trips a key until it expires, then reads as locked and deletes the entry', async () => {
    const { slot, store } = makeFakeKeychain()
    let now = 1_000
    const cache = makeKeychainKeyCache(store, { ttlMs: 500, now: () => now })

    await cache.set(key)
    expect(await cache.get()).toEqual(key)

    now = 1_499
    expect(await cache.get()).toEqual(key)

    now = 1_500
    expect(await cache.get()).toBeNull()
    expect(slot.value).toBeNull()
  })

  it('clears the key', async () => {
    const { slot, store } = makeFakeKeychain()
    const cache = makeKeychainKeyCache(store)

    await cache.set(key)
    await cache.clear()

    expect(slot.value).toBeNull()
    expect(await cache.get()).toBeNull()
  })

  it('treats a malformed entry as locked and deletes it', async () => {
    const { slot, store } = makeFakeKeychain()
    const cache = makeKeychainKeyCache(store)

    slot.value = 'not json'
    expect(await cache.get()).toBeNull()
    expect(slot.value).toBeNull()

    slot.value = JSON.stringify({ key: 42, expiresAt: 'soon' })
    expect(await cache.get()).toBeNull()
    expect(slot.value).toBeNull()
  })
})
