import { Effect } from 'effect'
import {
  VaultAlreadyInitializedError,
  VaultCorruptedError,
  VaultKeyMissingError,
  VaultKeyProviderError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultStorageError,
  type VaultService,
} from '../core/vault.ts'

export interface CliIo {
  readonly write: (message: string) => void
  readonly error: (message: string) => void
}

const usage = 'Usage: raphie vault <init|status|lock|unlock>'

const renderError = (error: unknown) => {
  if (error instanceof VaultAlreadyInitializedError) return 'Vault is already initialized.'
  if (error instanceof VaultNotInitializedError) return 'Vault is not initialized. Run `raphie vault init`.'
  if (error instanceof VaultLockedError) return 'Vault is locked. Run `raphie vault unlock`.'
  if (error instanceof VaultKeyMissingError) return 'Vault key is unavailable.'
  if (error instanceof VaultCorruptedError) return 'Vault could not be opened because its contents are invalid.'
  if (error instanceof VaultStorageError) return 'Vault storage is unavailable.'
  if (error instanceof VaultKeyProviderError) return 'Vault key storage is unavailable.'
  return 'Vault operation failed.'
}

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
      ? vault.initialize().pipe(Effect.tap(() => Effect.sync(() => io.write('Vault initialized.'))))
      : command === 'status'
        ? vault.status().pipe(Effect.tap((status) => Effect.sync(() => io.write(`Vault: ${status}`))))
        : command === 'lock'
          ? vault.lock().pipe(Effect.tap(() => Effect.sync(() => io.write('Vault locked.'))))
          : vault.unlock().pipe(Effect.tap(() => Effect.sync(() => io.write('Vault unlocked.'))))

  return action.pipe(
    Effect.as(0),
    Effect.catchAll((error) => Effect.sync(() => {
      io.error(renderError(error))
      return 1
    })),
  )
}
