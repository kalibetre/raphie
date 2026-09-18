import { Context, Data, Effect } from 'effect'
import {
  decryptVaultState,
  encryptVaultState,
  generateVaultKey,
  isVaultKey,
  VAULT_FORMAT_VERSION,
  VAULT_NONCE_LENGTH,
  type EncryptedVaultState,
} from './vaultCrypto.ts'

export type VaultLockState = 'locked' | 'unlocked'
export type VaultStatus = 'uninitialized' | VaultLockState

export interface VaultRecord extends EncryptedVaultState {
  readonly formatVersion: number
  readonly lockState: VaultLockState
}

export interface VaultStorage {
  readonly read: () => Promise<VaultRecord | null>
  readonly create: (record: VaultRecord) => Promise<void>
  readonly remove: () => Promise<void>
  readonly updateLockState: (lockState: VaultLockState) => Promise<void>
}

export interface VaultKeyProvider {
  readonly read: () => Promise<Uint8Array | null>
  readonly write: (key: Uint8Array) => Promise<void>
}

export class VaultAlreadyInitializedError extends Data.TaggedError('VaultAlreadyInitializedError')<{}> {}

export class VaultNotInitializedError extends Data.TaggedError('VaultNotInitializedError')<{}> {}

export class VaultLockedError extends Data.TaggedError('VaultLockedError')<{}> {}

export class VaultKeyMissingError extends Data.TaggedError('VaultKeyMissingError')<{}> {}

export class VaultCorruptedError extends Data.TaggedError('VaultCorruptedError')<{}> {}

export class VaultStorageError extends Data.TaggedError('VaultStorageError')<{
  readonly operation: 'read' | 'create' | 'remove' | 'update-lock-state'
}> {}

export class VaultKeyProviderError extends Data.TaggedError('VaultKeyProviderError')<{
  readonly operation: 'read' | 'write'
}> {}

export interface VaultService {
  readonly status: () => Effect.Effect<VaultStatus, VaultError>
  readonly initialize: () => Effect.Effect<void, VaultError>
  readonly lock: () => Effect.Effect<void, VaultError>
  readonly unlock: () => Effect.Effect<void, VaultError>
  readonly requireUnlocked: () => Effect.Effect<void, VaultError>
}

export type VaultError =
  | VaultAlreadyInitializedError
  | VaultNotInitializedError
  | VaultLockedError
  | VaultKeyMissingError
  | VaultCorruptedError
  | VaultStorageError
  | VaultKeyProviderError

export class Vault extends Context.Tag('Vault')<Vault, VaultService>() {}

const storageOperation = <A>(operation: VaultStorageError['operation'], action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: () => new VaultStorageError({ operation }),
  })

const keyOperation = <A>(operation: VaultKeyProviderError['operation'], action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: () => new VaultKeyProviderError({ operation }),
  })

export const makeVault = (storage: VaultStorage, keyProvider: VaultKeyProvider): VaultService => {
  const readRecord = () => storageOperation('read', () => storage.read())

  const requireRecord = () =>
    readRecord().pipe(
      Effect.flatMap((record) => (record === null ? Effect.fail(new VaultNotInitializedError()) : Effect.succeed(record))),
    )

  const readKey = (): Effect.Effect<Uint8Array, VaultKeyMissingError | VaultCorruptedError | VaultKeyProviderError> =>
    keyOperation('read', () => keyProvider.read()).pipe(
      Effect.flatMap((key): Effect.Effect<Uint8Array, VaultKeyMissingError | VaultCorruptedError> => {
        if (key === null) return Effect.fail(new VaultKeyMissingError())
        if (!isVaultKey(key)) return Effect.fail(new VaultCorruptedError())
        return Effect.succeed(key)
      }),
    )

  const verifyRecord = (record: VaultRecord): Effect.Effect<void, VaultError> => {
    if (
      record.formatVersion !== VAULT_FORMAT_VERSION ||
      record.nonce.byteLength !== VAULT_NONCE_LENGTH ||
      record.ciphertext.byteLength === 0
    ) {
      return Effect.fail(new VaultCorruptedError())
    }

    return Effect.gen(function* () {
      const key = yield* readKey()
      yield* Effect.tryPromise({
        try: () => decryptVaultState(key, record),
        catch: () => new VaultCorruptedError(),
      })
    })
  }

  const status = (): Effect.Effect<VaultStatus, VaultError> =>
    Effect.gen(function* () {
      const record = yield* readRecord()
      if (record === null) return 'uninitialized' as const
      if (record.lockState === 'locked') return 'locked' as const
      yield* verifyRecord(record)
      return 'unlocked' as const
    })

  const initialize = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const existing = yield* readRecord()
      if (existing !== null) return yield* Effect.fail(new VaultAlreadyInitializedError())

      const existingKey = yield* keyOperation('read', () => keyProvider.read())
      if (existingKey !== null) return yield* Effect.fail(new VaultCorruptedError())

      const key = generateVaultKey()
      const encrypted = yield* Effect.tryPromise({
        try: () => encryptVaultState(key),
        catch: () => new VaultCorruptedError(),
      })

      yield* storageOperation('create', () =>
        storage.create({
          formatVersion: VAULT_FORMAT_VERSION,
          lockState: 'locked',
          ...encrypted,
        }),
      )

      const keyWrite = yield* Effect.either(keyOperation('write', () => keyProvider.write(key)))
      if (keyWrite._tag === 'Left') {
        yield* storageOperation('remove', () => storage.remove()).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        return yield* Effect.fail(keyWrite.left)
      }

      yield* storageOperation('update-lock-state', () => storage.updateLockState('unlocked'))
    })

  const lock = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const record = yield* requireRecord()
      if (record.lockState === 'locked') return
      yield* storageOperation('update-lock-state', () => storage.updateLockState('locked'))
    })

  const unlock = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const record = yield* requireRecord()
      yield* verifyRecord(record)
      if (record.lockState === 'unlocked') return
      yield* storageOperation('update-lock-state', () => storage.updateLockState('unlocked'))
    })

  const requireUnlocked = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const record = yield* requireRecord()
      if (record.lockState === 'locked') return yield* Effect.fail(new VaultLockedError())
      yield* verifyRecord(record)
    })

  return { status, initialize, lock, unlock, requireUnlocked }
}
