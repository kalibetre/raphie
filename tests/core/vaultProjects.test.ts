import { FileSystem, Path } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  deleteVaultEnvVar,
  importProjectEnvContent,
  importProjectEnvFile,
  listVaultEnvVars,
  listVaultProjects,
  registerVaultProject,
  removeVaultProject,
  setVaultEnvVar,
} from '../../src/core/vaultProjects.ts'
import { makeVault, Vault, type VaultRecord, type VaultStorage } from '../../src/core/vault.ts'
import { withProjectFixtures } from './fixtures.ts'

const password = 'correct horse battery staple'

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
      if (record === null) throw new Error('record does not exist')
      record = { ...record, lockState }
    },
    updateEncryptedState: async (encrypted) => {
      if (record === null) throw new Error('record does not exist')
      record = { ...record, ...encrypted }
    },
  }
  return storage
}

const runWithVault = <A, E>(
  effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>,
  vault: ReturnType<typeof makeVault>,
) =>
  effect.pipe(Effect.provide(Layer.succeed(Vault, vault)))

describe('Vault-backed Projects', () => {
  it('registers a Project without creating a Central env file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const result = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)

        expect(result.project.vaultBacked).toBe(true)
        expect(result.project.centralEnvFile).toBe('')
        expect(result.envFileFound).toBe(false)
        expect(yield* runWithVault(listVaultProjects, vault)).toEqual([result.project])
      }),
    ))

  it('imports an existing .env into the local Profile and can delete it afterward', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const envFile = path.join(projectFolder, '.env')
        yield* fs.writeFileString(envFile, 'API_URL=https://staging.example\nAPI_TOKEN=secret-value\n')

        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const { project } = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)
        const imported = yield* runWithVault(importProjectEnvFile(project, { deleteSourceFile: true }), vault)

        expect(imported.importedCount).toBe(2)
        expect(imported.deletedSourceFile).toBe(true)
        expect(yield* fs.exists(envFile)).toBe(false)
        expect(yield* runWithVault(listVaultEnvVars(project.id), vault)).toEqual([
          { key: 'API_URL', value: 'https://staging.example' },
          { key: 'API_TOKEN', value: 'secret-value' },
        ])
      }),
    ))

  it('keeps the source .env when deletion is not requested', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const envFile = path.join(projectFolder, '.env')
        yield* fs.writeFileString(envFile, 'KEEP_ME=yes\n')

        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const { project } = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)
        const imported = yield* runWithVault(importProjectEnvFile(project, { deleteSourceFile: false }), vault)

        expect(imported.deletedSourceFile).toBe(false)
        expect(yield* fs.exists(envFile)).toBe(true)
      }),
    ))

  it('imports pasted env content into the encrypted Profile without creating a file', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const envFile = path.join(projectFolder, '.env')
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const { project } = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)

        const imported = yield* runWithVault(
          importProjectEnvContent(project, 'API_URL=https://pasted.example\nAPI_TOKEN=pasted-value\n'),
          vault,
        )

        expect(imported.importedCount).toBe(2)
        expect(yield* fs.exists(envFile)).toBe(false)
        expect(yield* runWithVault(listVaultEnvVars(project.id), vault)).toEqual([
          { key: 'API_URL', value: 'https://pasted.example' },
          { key: 'API_TOKEN', value: 'pasted-value' },
        ])
      }),
    ))

  it('edits and deletes EnvVars in the encrypted Profile snapshot', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const { project } = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)

        yield* runWithVault(setVaultEnvVar(project.id, { key: 'NEW_KEY', value: 'new-value' }), vault)
        expect(yield* runWithVault(listVaultEnvVars(project.id), vault)).toEqual([
          { key: 'NEW_KEY', value: 'new-value' },
        ])
        yield* runWithVault(deleteVaultEnvVar(project.id, 'NEW_KEY'), vault)
        expect(yield* runWithVault(listVaultEnvVars(project.id), vault)).toEqual([])
      }),
    ))

  it('removes a Project without resetting the Vault', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const { project } = yield* runWithVault(registerVaultProject({ folderPath: projectFolder }), vault)

        expect(yield* runWithVault(removeVaultProject(project.id), vault)).toBe(true)
        expect(yield* runWithVault(listVaultProjects, vault)).toEqual([])
        expect(yield* vault.status()).toBe('unlocked')
      }),
    ))
})
