import { Effect } from 'effect'
import { AppLive } from '../core/runtime.ts'
import { Vault } from '../core/vault.ts'
import { runVaultCli, type CliIo } from './vault.ts'

export const isCliInvocation = (args: readonly string[]) => args[0] === 'vault'

const defaultIo: CliIo = {
  write: (message) => console.log(message),
  error: (message) => console.error(message),
}

export const runCli = (args: readonly string[], io: CliIo = defaultIo) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault
      return yield* runVaultCli(args, vault, io)
    }).pipe(Effect.provide(AppLive)),
  )
