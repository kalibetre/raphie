import { Effect, Layer } from 'effect'
import { AppHome } from './AppHome.ts'
import { Vault, makeVault, memoryKeyCacheFor } from './vault.ts'
import { makeBunSecretStore, makeKeychainKeyCache } from './vaultKeyCache.ts'
import { makeSqliteVaultStorage } from './vaultStorage.ts'

export const VaultLive = Layer.effect(
  Vault,
  Effect.gen(function* () {
    const home = yield* AppHome
    // vitest workers have no Bun global; they fall back to a per-process key.
    const keys =
      typeof Bun !== 'undefined' && Bun.secrets !== undefined
        ? makeKeychainKeyCache(makeBunSecretStore(home))
        : memoryKeyCacheFor(home)
    return makeVault(makeSqliteVaultStorage(home), keys)
  }),
)
