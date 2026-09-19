import { Effect } from 'effect'
import {
  VaultAlreadyInitializedError,
  VaultCorruptedError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultPasswordError,
  VaultStorageError,
  type VaultService,
} from '../core/vault.ts'

export interface CliIo {
  readonly write: (message: string) => void
  readonly error: (message: string) => void
  readonly readSecret: (prompt: string) => Promise<string>
}

const usage = 'Usage: raphie vault <init|status|lock|unlock>'

const renderError = (error: unknown) => {
  if (error instanceof VaultAlreadyInitializedError) return 'Vault is already initialized.'
  if (error instanceof VaultNotInitializedError) return 'Vault is not initialized. Run `raphie vault init`.'
  if (error instanceof VaultLockedError) return 'Vault is locked. Run `raphie vault unlock`.'
  if (error instanceof VaultPasswordError) return 'The Vault password was rejected.'
  if (error instanceof VaultCorruptedError) return 'Vault could not be opened because its contents are invalid.'
  if (error instanceof VaultStorageError) return 'Vault storage is unavailable.'
  return 'Vault operation failed.'
}

const readPassword = (io: CliIo, prompt: string) =>
  Effect.tryPromise({
    try: () => io.readSecret(prompt),
    catch: () => new Error('password prompt failed'),
  })

const initializeVault = (vault: VaultService, io: CliIo) =>
  readPassword(io, 'Create Vault password: ').pipe(
    Effect.flatMap((password) =>
      readPassword(io, 'Confirm Vault password: ').pipe(
        Effect.flatMap((confirmation) =>
          confirmation === password ? vault.initialize(password) : Effect.fail(new VaultPasswordError()),
        ),
      ),
    ),
  )

export const runVaultCli = (
  args: readonly string[],
  vault: VaultService,
  io: CliIo,
): Effect.Effect<number> => {
  const [resource, command] = args
  if (resource !== 'vault' || command === undefined || args.length !== 2 || !['init', 'status', 'lock', 'unlock'].includes(command)) {
    io.error(usage)
    return Effect.succeed(2)
  }

  const action =
    command === 'init'
      ? initializeVault(vault, io).pipe(
          Effect.tap(() => Effect.sync(() => io.write('Vault initialized.'))),
        )
      : command === 'status'
        ? vault.status().pipe(Effect.tap((status) => Effect.sync(() => io.write(`Vault: ${status}`))))
        : command === 'lock'
          ? vault.lock().pipe(Effect.tap(() => Effect.sync(() => io.write('Vault locked.'))))
          : readPassword(io, 'Vault password: ').pipe(
              Effect.flatMap((password) => vault.unlock(password)),
              Effect.tap(() => Effect.sync(() => io.write('Vault unlocked.'))),
            )

  return action.pipe(
    Effect.as(0),
    Effect.catchAll((error) => Effect.sync(() => {
      io.error(renderError(error))
      return 1
    })),
  )
}
