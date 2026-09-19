import { FileSystem, Path } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createVaultProfile,
  deleteVaultEnvVar,
  importProjectEnvContent,
  importProjectEnvFile,
  listVaultEnvVars,
  listVaultProfiles,
  listVaultProjects,
  registerVaultProject,
  removeVaultProject,
  resolveVaultProject,
  setVaultDefaultProfile,
  setVaultEnvVar,
  VaultEnvVarError,
  VaultProfileNameError,
  VaultProjectHandleError,
  VaultProjectLocationError,
  VaultProjectResolutionError,
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

  it('registers a Project with a unique handle and rejects invalid, duplicate, and repeated locations', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const otherFolder = path.join(projectFolder, 'other')
        yield* fs.makeDirectory(otherFolder)
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const run = <A, E>(effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>) =>
          runWithVault(effect, vault)

        const { project } = yield* run(registerVaultProject({ folderPath: projectFolder, handle: 'agent-barn' }))
        expect(project.handle).toBe('agent-barn')
        expect(project.defaultProfile).toBe('local')

        const failure = <A, E>(effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>) =>
          run(Effect.flip(effect))
        expect(yield* failure(registerVaultProject({ folderPath: otherFolder, handle: 'agent-barn' }))).toEqual(
          new VaultProjectHandleError({ reason: 'duplicate' }),
        )
        expect(yield* failure(registerVaultProject({ folderPath: otherFolder, handle: 'Not Valid' }))).toEqual(
          new VaultProjectHandleError({ reason: 'invalid' }),
        )
        expect(yield* failure(registerVaultProject({ folderPath: projectFolder, handle: 'again' }))).toEqual(
          new VaultProjectLocationError({ reason: 'duplicate' }),
        )
        expect(yield* failure(registerVaultProject({ folderPath: path.join(projectFolder, 'missing'), handle: 'gone' }))).toEqual(
          new VaultProjectLocationError({ reason: 'not-a-directory' }),
        )

        // Without an explicit handle one is derived from the folder name and kept unique.
        const derived = yield* run(registerVaultProject({ folderPath: otherFolder }))
        expect(derived.project.handle).toBe('other')
      }),
    ))

  it('gives legacy Projects a handle and default Profile when the Vault state is read', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const legacy = { id: 'abcd1234', name: 'My App', folderPath: projectFolder }
        yield* vault.writeState({
          projects: [legacy as never],
          profiles: [{ id: 'p1', projectId: legacy.id, name: 'local', envVars: [] }],
        })

        const [project] = yield* runWithVault(listVaultProjects, vault)
        expect(project).toMatchObject({ handle: 'my-app', defaultProfile: 'local' })
      }),
    ))

  it('creates independent Profiles and switches the default Profile explicitly', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const run = <A, E>(effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>) =>
          runWithVault(effect, vault)
        const { project } = yield* run(registerVaultProject({ folderPath: projectFolder, handle: 'app' }))

        yield* run(setVaultEnvVar(project.id, { key: 'SHARED', value: 'local-value' }))
        yield* run(createVaultProfile(project.id, 'staging'))
        expect(yield* run(listVaultEnvVars(project.id, 'staging'))).toEqual([])

        yield* run(setVaultEnvVar(project.id, { key: 'SHARED', value: 'staging-value' }, { profileName: 'staging' }))
        expect(yield* run(listVaultEnvVars(project.id, 'local'))).toEqual([{ key: 'SHARED', value: 'local-value' }])
        expect(yield* run(listVaultEnvVars(project.id, 'staging'))).toEqual([{ key: 'SHARED', value: 'staging-value' }])

        expect(yield* run(listVaultProfiles(project.id))).toEqual([
          { name: 'local', isDefault: true, envVarCount: 1 },
          { name: 'staging', isDefault: false, envVarCount: 1 },
        ])

        yield* run(setVaultDefaultProfile(project.id, 'staging'))
        expect(yield* run(listVaultEnvVars(project.id))).toEqual([{ key: 'SHARED', value: 'staging-value' }])
        expect((yield* run(listVaultProjects))[0]!.defaultProfile).toBe('staging')

        expect(yield* run(Effect.flip(createVaultProfile(project.id, 'staging')))).toEqual(
          new VaultProfileNameError({ reason: 'duplicate' }),
        )
        expect(yield* run(Effect.flip(createVaultProfile(project.id, 'Not Valid')))).toEqual(
          new VaultProfileNameError({ reason: 'invalid' }),
        )
        expect(yield* run(Effect.flip(setVaultDefaultProfile(project.id, 'nope')))).toMatchObject({
          _tag: 'VaultProfileNotFoundError',
        })
      }),
    ))

  it('rejects invalid and duplicate EnvVar keys as typed failures', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const run = <A, E>(effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>) =>
          runWithVault(effect, vault)
        const { project } = yield* run(registerVaultProject({ folderPath: projectFolder }))
        yield* run(setVaultEnvVar(project.id, { key: 'TAKEN', value: 'a' }))
        yield* run(setVaultEnvVar(project.id, { key: 'OTHER', value: 'b' }))

        expect(yield* run(Effect.flip(setVaultEnvVar(project.id, { key: 'TAKEN', value: 'c' })))).toBeInstanceOf(
          VaultEnvVarError,
        )
        expect(yield* run(Effect.flip(setVaultEnvVar(project.id, { key: 'A=B', value: 'c' })))).toBeInstanceOf(
          VaultEnvVarError,
        )
        expect(
          yield* run(Effect.flip(setVaultEnvVar(project.id, { key: 'TAKEN', value: 'c' }, { previousKey: 'OTHER' }))),
        ).toBeInstanceOf(VaultEnvVarError)
        expect(
          yield* run(Effect.flip(setVaultEnvVar(project.id, { key: 'X', value: 'c' }, { previousKey: 'MISSING' }))),
        ).toBeInstanceOf(VaultEnvVarError)
      }),
    ))

  it('resolves a Project by handle or by the current directory and fails closed otherwise', () =>
    withProjectFixtures(({ projectFolder }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const nested = path.join(projectFolder, 'packages', 'web')
        yield* fs.makeDirectory(nested, { recursive: true })
        const vault = makeVault(makeStorage())
        yield* vault.initialize(password)
        const run = <A, E>(effect: Effect.Effect<A, E, Vault | FileSystem.FileSystem | Path.Path>) =>
          runWithVault(effect, vault)
        const { project: outer } = yield* run(registerVaultProject({ folderPath: projectFolder, handle: 'outer' }))
        const { project: inner } = yield* run(registerVaultProject({ folderPath: nested, handle: 'inner' }))

        expect((yield* run(resolveVaultProject({ handle: 'outer', cwd: '/anywhere' }))).id).toBe(outer.id)
        expect((yield* run(resolveVaultProject({ cwd: projectFolder }))).id).toBe(outer.id)
        expect((yield* run(resolveVaultProject({ cwd: path.join(nested, 'src') }))).id).toBe(inner.id)

        expect(yield* run(Effect.flip(resolveVaultProject({ handle: 'missing', cwd: projectFolder })))).toEqual(
          new VaultProjectResolutionError({ reason: 'not-found' }),
        )
        expect(yield* run(Effect.flip(resolveVaultProject({ cwd: `${projectFolder}-sibling` })))).toEqual(
          new VaultProjectResolutionError({ reason: 'no-match' }),
        )
      }),
    ))
})
