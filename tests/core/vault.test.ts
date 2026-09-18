import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  makeVault,
  VaultAlreadyInitializedError,
  VaultCorruptedError,
  VaultKeyMissingError,
  VaultKeyProviderError,
  VaultLockedError,
  VaultNotInitializedError,
  type VaultKeyProvider,
  type VaultRecord,
  type VaultStorage,
} from '../../src/core/vault.ts'
import { makeSqliteVaultStorage } from '../../src/core/vaultStorage.ts'
import { withProjectFixtures } from './fixtures.ts'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const runFailure = async <A, E>(effect: Effect.Effect<A, E>) => {
  const result = await run(Effect.either(effect))
  if (result._tag === 'Right') throw new Error('expected Effect to fail')
  return result.left
}

const makeMemoryVault = () => {
  let record: VaultRecord | null = null
  let key: Uint8Array | null = null

  const storage: VaultStorage = {
    read: async () => record,
    create: async (next) => {
      if (record !== null) throw new Error('record already exists')
      record = next
    },
    remove: async () => {
      record = null
    },
    updateLockState: async (lockState) => {
      if (record === null) throw new Error('record does not exist')
      record = { ...record, lockState }
    },
  }

  const keyProvider: VaultKeyProvider = {
    read: async () => key,
    write: async (next) => {
      key = next
    },
  }

  return {
    vault: makeVault(storage, keyProvider),
    removeKey: () => {
      key = null
    },
  }
}

describe('Vault', () => {
  it('initializes, reports, locks, and unlocks a Vault through its lifecycle interface', async () => {
    const { vault } = makeMemoryVault()

    await expect(run(vault.status())).resolves.toBe('uninitialized')

    await run(vault.initialize())
    await expect(run(vault.status())).resolves.toBe('unlocked')

    await run(vault.lock())
    await expect(run(vault.status())).resolves.toBe('locked')
    expect(await runFailure(vault.requireUnlocked())).toBeInstanceOf(VaultLockedError)

    await run(vault.unlock())
    await expect(run(vault.status())).resolves.toBe('unlocked')
  })

  it('rejects lifecycle operations that require an initialized Vault', async () => {
    const { vault } = makeMemoryVault()

    expect(await runFailure(vault.lock())).toBeInstanceOf(VaultNotInitializedError)
    expect(await runFailure(vault.unlock())).toBeInstanceOf(VaultNotInitializedError)
    expect(await runFailure(vault.requireUnlocked())).toBeInstanceOf(VaultNotInitializedError)
  })

  it('does not initialize the same Vault twice', async () => {
    const { vault } = makeMemoryVault()

    await run(vault.initialize())

    expect(await runFailure(vault.initialize())).toBeInstanceOf(VaultAlreadyInitializedError)
  })

  it('rolls back the storage record when key storage fails during initialization', async () => {
    let record: VaultRecord | null = null
    const storage: VaultStorage = {
      read: async () => record,
      create: async (next) => {
        record = next
      },
      remove: async () => {
        record = null
      },
      updateLockState: async () => undefined,
    }
    const keyProvider: VaultKeyProvider = {
      read: async () => null,
      write: async () => {
        throw new Error('keychain unavailable')
      },
    }
    const vault = makeVault(storage, keyProvider)

    expect(await runFailure(vault.initialize())).toBeInstanceOf(VaultKeyProviderError)
    expect(await run(vault.status())).toBe('uninitialized')
  })

  it('does not overwrite an orphaned key during initialization', async () => {
    const storage: VaultStorage = {
      read: async () => null,
      create: async () => undefined,
      remove: async () => undefined,
      updateLockState: async () => undefined,
    }
    let key: Uint8Array | null = new Uint8Array(32).fill(7)
    const keyProvider: VaultKeyProvider = {
      read: async () => key,
      write: async (next) => {
        key = next
      },
    }
    const orphanedVault = makeVault(storage, keyProvider)

    expect(await runFailure(orphanedVault.initialize())).toBeInstanceOf(VaultCorruptedError)
    expect(key).toEqual(new Uint8Array(32).fill(7))
  })

  it('fails safely when an unlocked Vault no longer has its key', async () => {
    const { vault, removeKey } = makeMemoryVault()

    await run(vault.initialize())
    removeKey()

    expect(await runFailure(vault.status())).toBeInstanceOf(VaultKeyMissingError)
    expect(await runFailure(vault.requireUnlocked())).toBeInstanceOf(VaultKeyMissingError)
  })

  it('persists its lifecycle state through the SQLite storage adapter', () =>
    withProjectFixtures(({ home }) =>
      Effect.gen(function* () {
        let key: Uint8Array | null = null
        const keyProvider: VaultKeyProvider = {
          read: async () => key,
          write: async (next) => {
            key = next
          },
        }

        const first = makeVault(makeSqliteVaultStorage(home), keyProvider)
        yield* first.initialize()
        yield* first.lock()

        const reopened = makeVault(makeSqliteVaultStorage(home), keyProvider)
        expect(yield* reopened.status()).toBe('locked')

        yield* reopened.unlock()
        expect(yield* reopened.status()).toBe('unlocked')
      }),
    ))
})
