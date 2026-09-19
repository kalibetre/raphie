import { Effect } from 'effect'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  makeVault,
  VaultAlreadyInitializedError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultPasswordError,
  type VaultRecord,
  type VaultStorage,
} from '../../src/core/vault.ts'
import { makeSqliteVaultStorage, vaultDatabasePath } from '../../src/core/vaultStorage.ts'
import { withProjectFixtures } from './fixtures.ts'

const password = 'correct horse battery staple'
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const runFailure = async <A, E>(effect: Effect.Effect<A, E>) => {
  const result = await run(Effect.either(effect))
  if (result._tag === 'Right') throw new Error('expected Effect to fail')
  return result.left
}

const makeMemoryVault = () => {
  let record: VaultRecord | null = null
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
    updateEncryptedState: async (encrypted) => {
      if (record === null) throw new Error('record does not exist')
      record = { ...record, ...encrypted }
    },
  }

  return { vault: makeVault(storage), storage }
}

describe('Vault', () => {
  it('initializes, reports, locks, unlocks, and reads encrypted state', async () => {
    const { vault } = makeMemoryVault()

    await expect(run(vault.status())).resolves.toBe('uninitialized')

    await run(vault.initialize(password))
    await expect(run(vault.status())).resolves.toBe('unlocked')
    await expect(run(vault.readState())).resolves.toEqual({ projects: [], profiles: [] })

    await run(vault.lock())
    await expect(run(vault.status())).resolves.toBe('locked')
    expect(await runFailure(vault.readState())).toBeInstanceOf(VaultLockedError)

    await run(vault.unlock(password))
    await expect(run(vault.status())).resolves.toBe('unlocked')
  })

  it('rejects an incorrect password without revealing state', async () => {
    const { vault } = makeMemoryVault()
    await run(vault.initialize(password))
    await run(vault.lock())

    expect(await runFailure(vault.unlock('not the password'))).toBeInstanceOf(VaultPasswordError)
  })

  it('rejects lifecycle operations that require an initialized Vault', async () => {
    const { vault } = makeMemoryVault()

    expect(await runFailure(vault.lock())).toBeInstanceOf(VaultNotInitializedError)
    expect(await runFailure(vault.unlock(password))).toBeInstanceOf(VaultNotInitializedError)
    expect(await runFailure(vault.readState())).toBeInstanceOf(VaultNotInitializedError)
  })

  it('rejects a password that is too short', async () => {
    const { vault } = makeMemoryVault()

    expect(await runFailure(vault.initialize('short'))).toBeInstanceOf(VaultPasswordError)
  })

  it('does not initialize the same Vault twice', async () => {
    const { vault } = makeMemoryVault()

    await run(vault.initialize(password))

    expect(await runFailure(vault.initialize(password))).toBeInstanceOf(VaultAlreadyInitializedError)
  })

  it('persists encrypted Project and Profile state through the SQLite adapter', () =>
    withProjectFixtures(({ home }) =>
      Effect.gen(function* () {
        const first = makeVault(makeSqliteVaultStorage(home))
        yield* first.initialize(password)
        yield* first.writeState({
          projects: [{ id: 'project-1', name: 'Agent Barn', folderPath: '/projects/agent-barn' }],
          profiles: [
            {
              id: 'profile-1',
              projectId: 'project-1',
              name: 'staging',
              envVars: [{ key: 'API_TOKEN', value: 'not-for-output' }],
            },
          ],
        })
        const reopened = makeVault(makeSqliteVaultStorage(home))
        expect(yield* reopened.status()).toBe('locked')
        yield* reopened.unlock(password)
        expect(yield* reopened.readState()).toEqual({
          projects: [{ id: 'project-1', name: 'Agent Barn', folderPath: '/projects/agent-barn' }],
          profiles: [
            {
              id: 'profile-1',
              projectId: 'project-1',
              name: 'staging',
              envVars: [{ key: 'API_TOKEN', value: 'not-for-output' }],
            },
          ],
        })
      }),
    ))

  it('can initialize the password-backed format beside a legacy Vault table', () =>
    withProjectFixtures(({ home }) =>
      Effect.gen(function* () {
        const database = new DatabaseSync(vaultDatabasePath(home))
        database.exec(`
          CREATE TABLE vault_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            format_version INTEGER NOT NULL,
            lock_state TEXT NOT NULL,
            nonce BLOB NOT NULL,
            ciphertext BLOB NOT NULL
          )
        `)
        database.close()

        const vault = makeVault(makeSqliteVaultStorage(home))
        expect(yield* vault.status()).toBe('uninitialized')
        yield* vault.initialize(password)
        expect(yield* vault.status()).toBe('unlocked')
      }),
    ))
})
