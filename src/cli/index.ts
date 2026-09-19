import { Effect } from 'effect'
import { stdin, stderr } from 'node:process'
import { AppLive } from '../core/runtime.ts'
import { Vault } from '../core/vault.ts'
import { runVaultCli, type CliIo } from './vault.ts'

export const isCliInvocation = (args: readonly string[]) => args[0] === 'vault'

let pipedSecrets: Promise<string[]> | null = null

const readSecretFromStdin = (prompt: string) => {
  stderr.write(prompt)

  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    pipedSecrets ??= (async () => {
      const chunks: string[] = []
      for await (const chunk of stdin) {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      }
      return chunks.join('').split(/\r?\n/)
    })()
    return pipedSecrets.then((secrets) => secrets.shift() ?? '')
  }

  return new Promise<string>((resolve, reject) => {
    let value = ''
    const wasRaw = stdin.isRaw

    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw ?? false)
      stdin.pause()
      stderr.write('\n')
    }

    const onData = (chunk: string | Uint8Array) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      for (const character of text) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('password prompt cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += character
      }
    }

    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

const defaultIo: CliIo = {
  write: (message) => console.log(message),
  error: (message) => console.error(message),
  readSecret: readSecretFromStdin,
}

export const runCli = (args: readonly string[], io: CliIo = defaultIo) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vault = yield* Vault
      return yield* runVaultCli(args, vault, io)
    }).pipe(Effect.provide(AppLive)),
  )
