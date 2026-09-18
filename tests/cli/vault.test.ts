import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { runVaultCli, type CliIo } from '../../src/cli/vault.ts'
import { makeVault } from '../../src/core/vault.ts'
import type { VaultKeyProvider, VaultRecord, VaultStorage } from '../../src/core/vault.ts'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const makeCli = () => {
  let record: VaultRecord | null = null
  let key: Uint8Array | null = null

  const storage: VaultStorage = {
    read: async () => record,
    create: async (next) => {
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

  const output: string[] = []
  const errors: string[] = []
  const io: CliIo = {
    write: (message) => output.push(message),
    error: (message) => errors.push(message),
  }

  return { vault: makeVault(storage, keyProvider), io, output, errors }
}

describe('runVaultCli', () => {
  it('reports status without exposing values', async () => {
    const cli = makeCli()

    await expect(run(runVaultCli(['vault', 'status'], cli.vault, cli.io))).resolves.toBe(0)
    expect(cli.output).toEqual(['Vault: uninitialized'])
    expect(cli.errors).toEqual([])
  })

  it('runs the init, status, lock, and unlock lifecycle commands', async () => {
    const cli = makeCli()

    await expect(run(runVaultCli(['vault', 'init'], cli.vault, cli.io))).resolves.toBe(0)
    await expect(run(runVaultCli(['vault', 'status'], cli.vault, cli.io))).resolves.toBe(0)
    await expect(run(runVaultCli(['vault', 'lock'], cli.vault, cli.io))).resolves.toBe(0)
    await expect(run(runVaultCli(['vault', 'status'], cli.vault, cli.io))).resolves.toBe(0)
    await expect(run(runVaultCli(['vault', 'unlock'], cli.vault, cli.io))).resolves.toBe(0)
    await expect(run(runVaultCli(['vault', 'status'], cli.vault, cli.io))).resolves.toBe(0)

    expect(cli.output).toEqual([
      'Vault initialized.',
      'Vault: unlocked',
      'Vault locked.',
      'Vault: locked',
      'Vault unlocked.',
      'Vault: unlocked',
    ])
    expect(cli.errors).toEqual([])
  })

  it('returns a usage failure for an unknown command', async () => {
    const cli = makeCli()

    await expect(run(runVaultCli(['vault', 'reveal'], cli.vault, cli.io))).resolves.toBe(2)
    expect(cli.output).toEqual([])
    expect(cli.errors).toEqual(['Usage: raphie vault <init|status|lock|unlock>'])
  })

  it('renders lifecycle failures without exposing storage details', async () => {
    const cli = makeCli()

    await expect(run(runVaultCli(['vault', 'lock'], cli.vault, cli.io))).resolves.toBe(1)
    expect(cli.output).toEqual([])
    expect(cli.errors).toEqual(['Vault is not initialized. Run `raphie vault init`.'])
  })
})
