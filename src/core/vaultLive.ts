import { Effect, Layer } from 'effect'
import { AppHome } from './AppHome.ts'
import { Vault, makeVault } from './vault.ts'
import { makeBunSecretVaultKeyProvider } from './vaultKeyProvider.ts'
import { makeSqliteVaultStorage } from './vaultStorage.ts'

export const VaultLive = Layer.effect(
  Vault,
  Effect.gen(function* () {
    const home = yield* AppHome
    return makeVault(makeSqliteVaultStorage(home), makeBunSecretVaultKeyProvider(home))
  }),
)
