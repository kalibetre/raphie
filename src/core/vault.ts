import { Context, Data, Effect } from 'effect'
import {
  decryptVaultState,
  deriveVaultKey,
  encryptVaultState,
  generateVaultSalt,
  VAULT_FORMAT_VERSION,
  VAULT_NONCE_LENGTH,
  VAULT_PASSWORD_MIN_LENGTH,
  VAULT_SALT_LENGTH,
  type EncryptedVaultState,
} from './vaultCrypto.ts'

export type VaultLockState = 'locked' | 'unlocked'
export type VaultStatus = 'uninitialized' | VaultLockState

export interface VaultProjectRecord {
  readonly id: string
  readonly name: string
  readonly folderPath: string
}

export interface VaultProfileRecord {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly envVars: readonly { readonly key: string; readonly value: string }[]
}

export interface VaultState {
  readonly projects: readonly VaultProjectRecord[]
  readonly profiles: readonly VaultProfileRecord[]
}

export interface VaultRecord extends EncryptedVaultState {
  readonly formatVersion: number
  readonly lockState: VaultLockState
  readonly salt: Uint8Array
}

export interface VaultStorage {
  readonly read: () => Promise<VaultRecord | null>
  readonly create: (record: VaultRecord) => Promise<void>
  readonly remove: () => Promise<void>
  readonly updateLockState: (lockState: VaultLockState) => Promise<void>
  readonly updateEncryptedState: (encrypted: EncryptedVaultState) => Promise<void>
}

export interface VaultSession {
  key: Uint8Array | null
}

export class VaultAlreadyInitializedError extends Data.TaggedError('VaultAlreadyInitializedError')<{}> {}

export class VaultNotInitializedError extends Data.TaggedError('VaultNotInitializedError')<{}> {}

export class VaultLockedError extends Data.TaggedError('VaultLockedError')<{}> {}

export class VaultPasswordError extends Data.TaggedError('VaultPasswordError')<{}> {}

export class VaultCorruptedError extends Data.TaggedError('VaultCorruptedError')<{}> {}

export class VaultStorageError extends Data.TaggedError('VaultStorageError')<{
  readonly operation: 'read' | 'create' | 'remove' | 'update-lock-state' | 'update-encrypted-state'
}> {}

export interface VaultService {
  readonly status: () => Effect.Effect<VaultStatus, VaultError>
  readonly initialize: (password: string) => Effect.Effect<void, VaultError>
  readonly lock: () => Effect.Effect<void, VaultError>
  readonly unlock: (password: string) => Effect.Effect<void, VaultError>
  readonly requireUnlocked: () => Effect.Effect<void, VaultError>
  readonly readState: () => Effect.Effect<VaultState, VaultError>
  readonly writeState: (state: VaultState) => Effect.Effect<void, VaultError>
}

export type VaultError =
  | VaultAlreadyInitializedError
  | VaultNotInitializedError
  | VaultLockedError
  | VaultPasswordError
  | VaultCorruptedError
  | VaultStorageError

export class Vault extends Context.Tag('Vault')<Vault, VaultService>() {}

const sessions = new Map<string, VaultSession>()

export const createVaultSession = (): VaultSession => ({ key: null })

export const vaultSessionFor = (identity: string) => {
  const existing = sessions.get(identity)
  if (existing) return existing
  const session = createVaultSession()
  sessions.set(identity, session)
  return session
}

const clearSession = (session: VaultSession) => {
  session.key?.fill(0)
  session.key = null
}

const storageOperation = <A>(operation: VaultStorageError['operation'], action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: () => new VaultStorageError({ operation }),
  })

const validatePassword = (password: string) =>
  password.length >= VAULT_PASSWORD_MIN_LENGTH
    ? Effect.succeed(password)
    : Effect.fail(new VaultPasswordError())

const hasString = (value: unknown): value is string => typeof value === 'string'

const parseState = (value: unknown): VaultState => {
  if (!value || typeof value !== 'object') throw new Error('invalid vault state')
  const candidate = value as { readonly projects?: unknown; readonly profiles?: unknown }
  if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.profiles)) throw new Error('invalid vault state')

  for (const project of candidate.projects) {
    if (
      !project ||
      typeof project !== 'object' ||
      !hasString(project.id) ||
      !hasString(project.name) ||
      !hasString(project.folderPath)
    ) {
      throw new Error('invalid vault state')
    }
  }
  for (const profile of candidate.profiles) {
    if (
      !profile ||
      typeof profile !== 'object' ||
      !hasString(profile.id) ||
      !hasString(profile.projectId) ||
      !hasString(profile.name) ||
      !Array.isArray(profile.envVars)
    ) {
      throw new Error('invalid vault state')
    }
    for (const envVar of profile.envVars) {
      if (!envVar || typeof envVar !== 'object' || !hasString(envVar.key) || !hasString(envVar.value)) {
        throw new Error('invalid vault state')
      }
    }
  }

  return candidate as VaultState
}

const validateRecord = (record: VaultRecord) => {
  if (
    record.formatVersion !== VAULT_FORMAT_VERSION ||
    record.salt.byteLength !== VAULT_SALT_LENGTH ||
    record.nonce.byteLength !== VAULT_NONCE_LENGTH ||
    record.ciphertext.byteLength === 0
  ) {
    throw new Error('invalid vault record')
  }
}

export const makeVault = (storage: VaultStorage, session: VaultSession = createVaultSession()): VaultService => {
  const readRecord = () => storageOperation('read', () => storage.read())

  const requireRecord = () =>
    readRecord().pipe(
      Effect.flatMap((record) => (record === null ? Effect.fail(new VaultNotInitializedError()) : Effect.succeed(record))),
    )

  const requireKey = () =>
    session.key === null ? Effect.fail(new VaultLockedError()) : Effect.succeed(session.key)

  const decryptState = (record: VaultRecord, key: Uint8Array) =>
    Effect.tryPromise({
      try: async () => parseState(await decryptVaultState(key, record)),
      catch: () => new VaultCorruptedError(),
    })

  const checkedRecord = (record: VaultRecord) =>
    Effect.try({
      try: () => {
        validateRecord(record)
        return record
      },
      catch: () => new VaultCorruptedError(),
    })

  const readUnlockedState = () =>
    Effect.gen(function* () {
      const record = yield* requireRecord()
      if (record.lockState === 'locked') return yield* Effect.fail(new VaultLockedError())
      yield* checkedRecord(record)
      const key = yield* requireKey()
      return yield* decryptState(record, key)
    })

  const status = (): Effect.Effect<VaultStatus, VaultError> =>
    Effect.gen(function* () {
      const record = yield* readRecord()
      if (record === null) return 'uninitialized' as const
      if (record.lockState === 'locked' || session.key === null) return 'locked' as const
      yield* checkedRecord(record)
      yield* decryptState(record, session.key)
      return 'unlocked' as const
    })

  const initialize = (password: string): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      yield* validatePassword(password)
      const existing = yield* readRecord()
      if (existing !== null) return yield* Effect.fail(new VaultAlreadyInitializedError())

      const salt = generateVaultSalt()
      const key = yield* Effect.tryPromise({
        try: () => deriveVaultKey(password, salt),
        catch: () => new VaultPasswordError(),
      })
      const encrypted = yield* Effect.tryPromise({
        try: () => encryptVaultState(key, { projects: [], profiles: [] }),
        catch: () => new VaultCorruptedError(),
      })

      yield* storageOperation('create', () =>
        storage.create({
          formatVersion: VAULT_FORMAT_VERSION,
          lockState: 'locked',
          salt,
          ...encrypted,
        }),
      )
      yield* storageOperation('update-lock-state', () => storage.updateLockState('unlocked'))
      session.key = key
    })

  const lock = (): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      const record = yield* requireRecord()
      if (record.lockState === 'unlocked') yield* storageOperation('update-lock-state', () => storage.updateLockState('locked'))
      clearSession(session)
    })

  const unlock = (password: string): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      yield* validatePassword(password)
      const record = yield* requireRecord()
      yield* checkedRecord(record).pipe(Effect.mapError(() => new VaultPasswordError()))
      const key = yield* Effect.tryPromise({
        try: () => deriveVaultKey(password, record.salt),
        catch: () => new VaultPasswordError(),
      })
      yield* decryptState(record, key).pipe(Effect.mapError(() => new VaultPasswordError()))
      yield* storageOperation('update-lock-state', () => storage.updateLockState('unlocked'))
      session.key = key
    })

  const requireUnlocked = () => readUnlockedState().pipe(Effect.asVoid)

  const readState = () => readUnlockedState()

  const writeState = (state: VaultState): Effect.Effect<void, VaultError> =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => parseState(state),
        catch: () => new VaultCorruptedError(),
      })
      const record = yield* requireRecord()
      if (record.lockState === 'locked') return yield* Effect.fail(new VaultLockedError())
      yield* checkedRecord(record)
      const key = yield* requireKey()
      const encrypted = yield* Effect.tryPromise({
        try: () => encryptVaultState(key, state),
        catch: () => new VaultCorruptedError(),
      })
      yield* storageOperation('update-encrypted-state', () => storage.updateEncryptedState(encrypted))
    })

  return { status, initialize, lock, unlock, requireUnlocked, readState, writeState }
}
