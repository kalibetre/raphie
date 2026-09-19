import type { VaultKeyCache } from './vault.ts'

// ponytail: fixed lifetime from unlock, one constant — make it sliding or
// configurable if re-unlocking every hour proves annoying.
export const VAULT_KEY_TTL_MS = 60 * 60 * 1000

const keychainService = 'raphie-vault'

/** One secret slot in an OS credential store. */
export interface SecretStore {
  readonly get: () => Promise<string | null>
  readonly set: (value: string) => Promise<void>
  readonly delete: () => Promise<void>
}

/** The OS credential store slot for one Vault home, via Bun's native keychain binding. */
export const makeBunSecretStore = (home: string): SecretStore => {
  const slot = { service: keychainService, name: home }
  return {
    get: () => Bun.secrets.get(slot),
    set: (value) => Bun.secrets.set({ ...slot, value }),
    delete: async () => {
      await Bun.secrets.delete(slot)
    },
  }
}

/**
 * Shares an unlocked Vault key across processes (CLI invocations, GUI relaunch)
 * through the OS credential store. The password is never stored; the derived
 * key is, with an expiry that is enforced on read, so an expired or malformed
 * entry is deleted and reads as locked.
 */
export const makeKeychainKeyCache = (
  store: SecretStore,
  { ttlMs = VAULT_KEY_TTL_MS, now = Date.now }: { readonly ttlMs?: number; readonly now?: () => number } = {},
): VaultKeyCache => ({
  get: async () => {
    const raw = await store.get()
    if (raw === null) return null
    try {
      const entry = JSON.parse(raw) as { readonly key?: unknown; readonly expiresAt?: unknown }
      if (typeof entry.key === 'string' && typeof entry.expiresAt === 'number' && entry.expiresAt > now()) {
        return new Uint8Array(Buffer.from(entry.key, 'base64'))
      }
    } catch {
      // fall through: a malformed entry is treated like an expired one
    }
    await store.delete()
    return null
  },
  set: (key) => store.set(JSON.stringify({ key: Buffer.from(key).toString('base64'), expiresAt: now() + ttlMs })),
  clear: () => store.delete(),
})
