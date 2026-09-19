import { FileSystem, Path } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { runProjectCli } from '../../src/cli/projects.ts'
import type { CliIo } from '../../src/cli/vault.ts'
import { makeVault, Vault, type VaultRecord, type VaultStorage } from '../../src/core/vault.ts'
import { withProjectFixtures } from '../core/fixtures.ts'

const password = 'correct horse battery staple'
const secret = 'super-secret-value'

const makeStorage = () => {
  let record: VaultRecord | null = null
  const storage: VaultStorage = {
    read: async () => record,
    create: async (next) => {
      record = next
    },
    remove: async () => {
      record = null
    },
    updateLockState: async (lockState) => {
      record = { ...record!, lockState }
    },
    updateEncryptedState: async (encrypted) => {
      record = { ...record!, ...encrypted }
    },
  }
  return storage
}

/** One Vault shared across many CLI invocations, like separate processes sharing an unlock. */
const makeCli = (cwd: string) => {
  const storage = makeStorage()
  const vault = makeVault(storage)
  const output: string[] = []
  const errors: string[] = []
  const secrets: string[] = []
  let stdin = ''
  const io: CliIo = {
    cwd,
    write: (message) => output.push(message),
    error: (message) => errors.push(message),
    readSecret: async () => secrets.shift() ?? '',
    readStdin: async () => stdin,
  }
  const run = (...args: string[]) => {
    output.length = 0
    errors.length = 0
    return runProjectCli(args, io).pipe(
      Effect.provide(Layer.mergeAll(BunContext.layer, Layer.succeed(Vault, vault))),
    )
  }
  return {
    vault,
    run,
    output,
    errors,
    io,
    typeSecret: (value: string) => secrets.push(value),
    pipe: (value: string) => {
      stdin = value
    },
  }
}

describe('runProjectCli', () => {
  it('registers Projects and lists them without values or .env files', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)

        expect(yield* cli.run('project', 'add', '.', '--handle', 'agent-barn')).toBe(0)
        expect(cli.output.join('\n')).toContain('agent-barn')
        expect(yield* cli.run('project', 'list')).toBe(0)
        expect(cli.output).toEqual([`agent-barn\t${projectFolder}\tlocal`])
        expect(yield* fs.exists(path.join(projectFolder, '.env'))).toBe(false)

        expect(yield* cli.run('project', 'add', '.', '--handle', 'other')).toBe(1)
        expect(cli.errors).toEqual(['That location is already registered as a Project. Run `raphie project list`.'])
        expect(yield* cli.run('project', 'add', 'missing-dir', '--handle', 'gone')).toBe(1)
        expect(cli.errors).toEqual(['Project location is not an existing directory.'])
      }),
    ))

  it('rejects invalid and duplicate handles with remediation', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const second = path.join(projectFolder, 'second')
        yield* fs.makeDirectory(second)
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.run('project', 'add', '.', '--handle', 'app')

        expect(yield* cli.run('project', 'add', 'second', '--handle', 'app')).toBe(1)
        expect(cli.errors).toEqual(['A Project with that handle already exists. Choose another --handle.'])
        expect(yield* cli.run('project', 'add', 'second', '--handle', 'Bad Handle')).toBe(1)
        expect(cli.errors[0]).toContain('lowercase')
      }),
    ))

  it('manages Profiles: create, list, and an explicit default', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.run('project', 'add', '.', '--handle', 'app')

        expect(yield* cli.run('profile', 'create', 'staging')).toBe(0)
        expect(yield* cli.run('profile', 'create', 'staging')).toBe(1)
        expect(cli.errors).toEqual(['A Profile with that name already exists. Run `raphie profile list`.'])
        expect(yield* cli.run('profile', 'list')).toBe(0)
        expect(cli.output).toEqual(['* local (0 EnvVars)', '  staging (0 EnvVars)'])

        expect(yield* cli.run('profile', 'default', 'staging')).toBe(0)
        expect(yield* cli.run('profile', 'list')).toBe(0)
        expect(cli.output).toEqual(['  local (0 EnvVars)', '* staging (0 EnvVars)'])
        expect(yield* cli.run('profile', 'default', 'nope')).toBe(1)
        expect(cli.errors).toEqual(['Profile "nope" was not found. Run `raphie profile list`.'])
      }),
    ))

  it('adds, edits, deletes, and lists masked EnvVars per Profile without printing values', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.run('project', 'add', '.', '--handle', 'app')
        yield* cli.run('profile', 'create', 'staging')
        const everything = () => [...cli.output, ...cli.errors].join('\n')

        cli.typeSecret(secret)
        expect(yield* cli.run('env', 'add', 'API_TOKEN')).toBe(0)
        expect(everything()).not.toContain(secret)

        cli.pipe('piped-value\n')
        expect(yield* cli.run('env', 'set', 'API_TOKEN', '--from-stdin')).toBe(0)
        cli.typeSecret('staging-value')
        expect(yield* cli.run('env', 'set', 'API_TOKEN', '--profile', 'staging')).toBe(0)
        expect(everything()).not.toContain('staging-value')

        expect(yield* cli.run('env', 'list')).toBe(0)
        expect(cli.output).toEqual(['API_TOKEN=********'])
        expect(yield* cli.run('env', 'list', '--profile', 'staging')).toBe(0)
        expect(cli.output).toEqual(['API_TOKEN=********'])
        expect(yield* cli.vault.readState().pipe(Effect.map((state) => state.profiles.map((p) => p.envVars)))).toEqual([
          [{ key: 'API_TOKEN', value: 'piped-value' }],
          [{ key: 'API_TOKEN', value: 'staging-value' }],
        ])

        expect(yield* cli.run('env', 'delete', 'API_TOKEN')).toBe(2)
        expect(cli.errors).toEqual(['Deleting an EnvVar needs confirmation. Re-run with --yes.'])
        expect(yield* cli.run('env', 'delete', 'API_TOKEN', '--yes')).toBe(0)
        expect(yield* cli.run('env', 'delete', 'API_TOKEN', '--yes')).toBe(1)
        expect(yield* cli.run('env', 'list')).toBe(0)
        expect(cli.output).toEqual(['No EnvVars in Profile "local".'])
      }),
    ))

  it('rejects duplicate, invalid, and empty EnvVars without exposing values', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.run('project', 'add', '.', '--handle', 'app')
        cli.typeSecret(secret)
        yield* cli.run('env', 'add', 'TAKEN')

        // A duplicate is rejected before the value is prompted for.
        expect(yield* cli.run('env', 'add', 'TAKEN')).toBe(1)
        expect(cli.errors).toEqual(['EnvVar key "TAKEN" already exists. Use `raphie env set` to change it.'])
        // An invalid key is rejected before the value is prompted for, too.
        expect(yield* cli.run('env', 'add', 'BAD=KEY')).toBe(1)
        expect(cli.errors[0]).toContain('EnvVar key is invalid')
        cli.typeSecret('')
        expect(yield* cli.run('env', 'add', 'EMPTY')).toBe(2)
        expect(cli.errors).toEqual(['EnvVar value cannot be empty.'])
      }),
    ))

  it('resolves Projects by --project or the current directory and fails closed', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.run('project', 'add', '.', '--handle', 'app')

        expect(yield* cli.run('profile', 'list', '--project', 'app')).toBe(0)
        expect(yield* cli.run('profile', 'list', '--project', 'missing')).toBe(1)
        expect(cli.errors).toEqual(['No Project has that handle. Run `raphie project list`.'])

        const elsewhere = makeCli(`${projectFolder}-elsewhere`)
        yield* elsewhere.vault.initialize(password)
        expect(yield* elsewhere.run('profile', 'list')).toBe(1)
        expect(elsewhere.errors).toEqual([
          'The current directory is not inside a registered Project. Pass --project HANDLE.',
        ])
      }),
    ))

  it('tells the user to unlock a locked Vault and rejects unknown commands', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const cli = makeCli(projectFolder)
        yield* cli.vault.initialize(password)
        yield* cli.vault.lock()

        expect(yield* cli.run('project', 'list')).toBe(1)
        expect(cli.errors).toEqual(['Vault is locked. Run `raphie vault unlock`.'])
        expect(yield* cli.run('env', 'reveal')).toBe(2)
        expect(cli.errors[0]).toContain('Usage:')
        expect(yield* cli.run('env', 'list', '--bogus')).toBe(2)
      }),
    ))
})
