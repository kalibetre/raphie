import { FileSystem, Path } from '@effect/platform'
import { Data, Effect } from 'effect'
import type { EnvVar, Project } from './Domain.ts'
import { parseEnvVars } from './envVarFile.ts'
import { generateProjectId } from './ids.ts'
import { Vault, type VaultError, type VaultProfileRecord, type VaultState } from './vault.ts'

const defaultProfileName = 'local'

export class VaultProjectNotFoundError extends Data.TaggedError('VaultProjectNotFoundError')<{
  readonly projectId: string
}> {}

export class VaultProfileNotFoundError extends Data.TaggedError('VaultProfileNotFoundError')<{
  readonly projectId: string
  readonly profileName: string
}> {}

export class VaultEnvVarError extends Data.TaggedError('VaultEnvVarError')<{
  readonly message: string
}> {}

export interface VaultProjectRegistration {
  readonly project: Project
  readonly envFileFound: boolean
}

export interface VaultEnvVarOptions {
  readonly previousKey?: string
  readonly occurrence?: number
}

export interface VaultImportOptions {
  readonly deleteSourceFile?: boolean
}

export interface VaultImportResult {
  readonly importedCount: number
  readonly deletedSourceFile: boolean
}

const asProject = (project: VaultState['projects'][number]): Project => ({
  id: project.id,
  name: project.name,
  folderPath: project.folderPath,
  centralEnvFile: '',
  vaultBacked: true,
})

const findProfile = (state: VaultState, projectId: string, profileName: string) => {
  const profile = state.profiles.find((candidate) => candidate.projectId === projectId && candidate.name === profileName)
  return profile ?? null
}

const requireProfile = (state: VaultState, projectId: string, profileName: string) => {
  if (!state.projects.some((project) => project.id === projectId)) {
    return Effect.fail(new VaultProjectNotFoundError({ projectId }))
  }
  const profile = findProfile(state, projectId, profileName)
  return profile === null
    ? Effect.fail(new VaultProfileNotFoundError({ projectId, profileName }))
    : Effect.succeed(profile)
}

const updateProfile = (
  vault: { readonly readState: () => Effect.Effect<VaultState, VaultError>; readonly writeState: (state: VaultState) => Effect.Effect<void, VaultError> },
  projectId: string,
  profileName: string,
  update: (profile: VaultProfileRecord) => VaultProfileRecord,
) =>
  Effect.gen(function* () {
    const state = yield* vault.readState()
    const profile = yield* requireProfile(state, projectId, profileName)
    yield* vault.writeState({
      ...state,
      profiles: state.profiles.map((candidate) => (candidate.id === profile.id ? update(profile) : candidate)),
    })
  })

export const listVaultProjects = Effect.gen(function* () {
  const vault = yield* Vault
  const state = yield* vault.readState()
  return state.projects.map(asProject)
})

export const registerVaultProject = (input: {
  readonly folderPath: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const vault = yield* Vault
    const state = yield* vault.readState()
    const id = generateProjectId()
    const projectRecord = {
      id,
      name: path.basename(input.folderPath),
      folderPath: input.folderPath,
    }
    const profile: VaultProfileRecord = {
      id: crypto.randomUUID().slice(0, 8),
      projectId: id,
      name: defaultProfileName,
      envVars: [],
    }
    const envFileFound = yield* fs.exists(path.join(input.folderPath, '.env'))
    yield* vault.writeState({
      projects: [...state.projects, projectRecord],
      profiles: [...state.profiles, profile],
    })
    return { project: asProject(projectRecord), envFileFound }
  })

export const listVaultEnvVars = (
  projectId: string,
  profileName = defaultProfileName,
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    const profile = yield* requireProfile(state, projectId, profileName)
    return [...profile.envVars]
  })

const normalizedKey = (key: string) => {
  const value = key.trim()
  if (!value || /[\r\n=]/.test(value)) throw new Error('invalid environment variable key')
  return value
}

const findOccurrenceIndex = (envVars: readonly EnvVar[], key: string, occurrence: number) => {
  let seen = 0
  for (let index = 0; index < envVars.length; index += 1) {
    if (envVars[index]!.key !== key) continue
    if (seen === occurrence) return index
    seen += 1
  }
  return -1
}

export const setVaultEnvVar = (
  projectId: string,
  envVar: EnvVar,
  options: VaultEnvVarOptions = {},
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const key = yield* Effect.try({
      try: () => normalizedKey(envVar.key),
      catch: () => new VaultEnvVarError({ message: 'EnvVar key is invalid.' }),
    })
    const previousKey = options.previousKey?.trim()
    const occurrence = options.occurrence ?? 0
    let saved: EnvVar = { key, value: envVar.value }
    yield* updateProfile(vault, projectId, defaultProfileName, (profile) => {
      const targetIndex = previousKey === undefined ? -1 : findOccurrenceIndex(profile.envVars, previousKey, occurrence)
      if (previousKey !== undefined && targetIndex === -1) {
        throw new VaultEnvVarError({ message: 'The EnvVar to edit no longer exists.' })
      }
      if (profile.envVars.some((candidate, index) => index !== targetIndex && candidate.key === key)) {
        throw new VaultEnvVarError({ message: `EnvVar key "${key}" already exists.` })
      }
      const next = [...profile.envVars]
      if (targetIndex === -1) next.push(saved)
      else next[targetIndex] = saved
      return { ...profile, envVars: next }
    })
    return saved
  })

export const deleteVaultEnvVar = (
  projectId: string,
  target: string | { readonly key: string; readonly occurrence?: number },
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const key = typeof target === 'string' ? target.trim() : target.key.trim()
    const occurrence = typeof target === 'string' ? 0 : target.occurrence ?? 0
    let deleted = false
    yield* updateProfile(vault, projectId, defaultProfileName, (profile) => {
      const index = findOccurrenceIndex(profile.envVars, key, occurrence)
      if (index === -1) return profile
      deleted = true
      return { ...profile, envVars: profile.envVars.filter((_, candidateIndex) => candidateIndex !== index) }
    })
    return deleted
  })

export const importProjectEnvFile = (
  project: Project,
  options: VaultImportOptions = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const envFile = path.join(project.folderPath, '.env')
    const content = yield* fs.readFileString(envFile)
    const envVars = parseEnvVars(content)
    const vault = yield* Vault
    yield* updateProfile(vault, project.id, defaultProfileName, (profile) => ({ ...profile, envVars }))
    const deleteSourceFile = options.deleteSourceFile === true
    if (deleteSourceFile) yield* fs.remove(envFile)
    return { importedCount: envVars.length, deletedSourceFile: deleteSourceFile }
  })

export const removeVaultProject = (
  projectId: string,
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    if (!state.projects.some((project) => project.id === projectId)) return false
    yield* vault.writeState({
      projects: state.projects.filter((project) => project.id !== projectId),
      profiles: state.profiles.filter((profile) => profile.projectId !== projectId),
    })
    return true
  })
