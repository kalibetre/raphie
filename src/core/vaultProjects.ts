import { FileSystem, Path } from '@effect/platform'
import { Data, Effect } from 'effect'
import type { EnvVar, Project } from './Domain.ts'
import { parseEnvVars } from './envVarFile.ts'
import { generateProjectId } from './ids.ts'
import { Vault, type VaultError, type VaultProfileRecord, type VaultState } from './vault.ts'
import { deriveProjectHandle, isValidVaultName } from './vaultNames.ts'

const initialProfileName = 'local'

export class VaultProjectNotFoundError extends Data.TaggedError('VaultProjectNotFoundError')<{
  readonly projectId: string
}> {}

export class VaultProfileNotFoundError extends Data.TaggedError('VaultProfileNotFoundError')<{
  readonly projectId: string
  readonly profileName: string
}> {}

export class VaultProjectHandleError extends Data.TaggedError('VaultProjectHandleError')<{
  readonly reason: 'invalid' | 'duplicate'
}> {}

export class VaultProjectLocationError extends Data.TaggedError('VaultProjectLocationError')<{
  readonly reason: 'not-a-directory' | 'duplicate'
}> {}

export class VaultProjectResolutionError extends Data.TaggedError('VaultProjectResolutionError')<{
  readonly reason: 'not-found' | 'no-match' | 'ambiguous'
}> {}

export class VaultProfileNameError extends Data.TaggedError('VaultProfileNameError')<{
  readonly reason: 'invalid' | 'duplicate'
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
  /** Defaults to the Project's default Profile. */
  readonly profileName?: string
}

export interface VaultProfileSummary {
  readonly name: string
  readonly isDefault: boolean
  readonly envVarCount: number
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
  handle: project.handle,
  defaultProfile: project.defaultProfile,
  centralEnvFile: '',
  vaultBacked: true,
})

const requireProject = (state: VaultState, projectId: string) => {
  const project = state.projects.find((candidate) => candidate.id === projectId)
  return project === undefined ? Effect.fail(new VaultProjectNotFoundError({ projectId })) : Effect.succeed(project)
}

/** Finds a Profile by name, or the Project's default Profile when no name is given. */
const requireProfile = (state: VaultState, projectId: string, profileName?: string) =>
  Effect.gen(function* () {
    const project = yield* requireProject(state, projectId)
    const name = profileName ?? project.defaultProfile
    const profile = state.profiles.find((candidate) => candidate.projectId === projectId && candidate.name === name)
    return profile ?? (yield* Effect.fail(new VaultProfileNotFoundError({ projectId, profileName: name })))
  })

const updateProfile = <E>(
  vault: { readonly readState: () => Effect.Effect<VaultState, VaultError>; readonly writeState: (state: VaultState) => Effect.Effect<void, VaultError> },
  projectId: string,
  profileName: string | undefined,
  update: (profile: VaultProfileRecord) => Effect.Effect<VaultProfileRecord, E>,
) =>
  Effect.gen(function* () {
    const state = yield* vault.readState()
    const profile = yield* requireProfile(state, projectId, profileName)
    const updated = yield* update(profile)
    yield* vault.writeState({
      ...state,
      profiles: state.profiles.map((candidate) => (candidate.id === profile.id ? updated : candidate)),
    })
  })

export const listVaultProjects = Effect.gen(function* () {
  const vault = yield* Vault
  const state = yield* vault.readState()
  return state.projects.map(asProject)
})

export const registerVaultProject = (input: {
  readonly folderPath: string
  /** Defaults to one derived from the folder name. */
  readonly handle?: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const vault = yield* Vault
    const state = yield* vault.readState()
    const isDirectory = yield* fs.stat(input.folderPath).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.orElseSucceed(() => false),
    )
    if (!isDirectory) return yield* Effect.fail(new VaultProjectLocationError({ reason: 'not-a-directory' }))
    if (state.projects.some((project) => project.folderPath === input.folderPath)) {
      return yield* Effect.fail(new VaultProjectLocationError({ reason: 'duplicate' }))
    }
    const name = path.basename(input.folderPath)
    const taken = new Set(state.projects.map((project) => project.handle))
    if (input.handle !== undefined && !isValidVaultName(input.handle)) {
      return yield* Effect.fail(new VaultProjectHandleError({ reason: 'invalid' }))
    }
    if (input.handle !== undefined && taken.has(input.handle)) {
      return yield* Effect.fail(new VaultProjectHandleError({ reason: 'duplicate' }))
    }
    const id = generateProjectId()
    const projectRecord = {
      id,
      name,
      handle: input.handle ?? deriveProjectHandle(name, taken),
      folderPath: input.folderPath,
      defaultProfile: initialProfileName,
    }
    const profile: VaultProfileRecord = {
      id: generateProjectId(),
      projectId: id,
      name: initialProfileName,
      envVars: [],
    }
    const envFileFound = yield* fs.exists(path.join(input.folderPath, '.env'))
    yield* vault.writeState({
      projects: [...state.projects, projectRecord],
      profiles: [...state.profiles, profile],
    })
    return { project: asProject(projectRecord), envFileFound }
  })

/**
 * Resolves a Project by exact handle, or else by the registered location that
 * contains `cwd` (the deepest one wins). Fails closed rather than guessing.
 */
export const resolveVaultProject = (selector: { readonly handle?: string; readonly cwd: string }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const vault = yield* Vault
    const { projects } = yield* vault.readState()
    if (selector.handle !== undefined) {
      const project = projects.find((candidate) => candidate.handle === selector.handle)
      return project === undefined
        ? yield* Effect.fail(new VaultProjectResolutionError({ reason: 'not-found' }))
        : asProject(project)
    }
    // ponytail: plain path-prefix match, no realpath — a Project registered through a symlink
    // won't match its real cwd; resolve symlinks at registration if that bites.
    const containing = projects.filter(
      (project) => selector.cwd === project.folderPath || selector.cwd.startsWith(project.folderPath + path.sep),
    )
    const depth = Math.max(0, ...containing.map((project) => project.folderPath.length))
    const deepest = containing.filter((project) => project.folderPath.length === depth)
    if (deepest.length === 0) return yield* Effect.fail(new VaultProjectResolutionError({ reason: 'no-match' }))
    if (deepest.length > 1) return yield* Effect.fail(new VaultProjectResolutionError({ reason: 'ambiguous' }))
    return asProject(deepest[0]!)
  })

export const listVaultProfiles = (projectId: string) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    const project = yield* requireProject(state, projectId)
    return state.profiles
      .filter((profile) => profile.projectId === projectId)
      .map((profile): VaultProfileSummary => ({
        name: profile.name,
        isDefault: profile.name === project.defaultProfile,
        envVarCount: profile.envVars.length,
      }))
  })

/** Creates an empty Profile; Profiles never inherit from or copy another Profile. */
export const createVaultProfile = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    yield* requireProject(state, projectId)
    if (!isValidVaultName(name)) return yield* Effect.fail(new VaultProfileNameError({ reason: 'invalid' }))
    if (state.profiles.some((profile) => profile.projectId === projectId && profile.name === name)) {
      return yield* Effect.fail(new VaultProfileNameError({ reason: 'duplicate' }))
    }
    yield* vault.writeState({
      ...state,
      profiles: [...state.profiles, { id: generateProjectId(), projectId, name, envVars: [] }],
    })
  })

export const setVaultDefaultProfile = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    yield* requireProfile(state, projectId, name)
    yield* vault.writeState({
      ...state,
      projects: state.projects.map((project) => (project.id === projectId ? { ...project, defaultProfile: name } : project)),
    })
  })

export const listVaultEnvVars = (
  projectId: string,
  profileName?: string,
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const state = yield* vault.readState()
    const profile = yield* requireProfile(state, projectId, profileName)
    return [...profile.envVars]
  })

/** Trims an EnvVar key and rejects one that cannot be written as `KEY=value`. */
export const validateVaultEnvVarKey = (key: string) => {
  const value = key.trim()
  return !value || /[\r\n=]/.test(value)
    ? Effect.fail(new VaultEnvVarError({ message: 'EnvVar key is invalid: it must not be empty or contain "=" or line breaks.' }))
    : Effect.succeed(value)
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
    const key = yield* validateVaultEnvVarKey(envVar.key)
    const previousKey = options.previousKey?.trim()
    const occurrence = options.occurrence ?? 0
    let saved: EnvVar = { key, value: envVar.value }
    yield* updateProfile(vault, projectId, options.profileName, (profile) => {
      const targetIndex = previousKey === undefined ? -1 : findOccurrenceIndex(profile.envVars, previousKey, occurrence)
      if (previousKey !== undefined && targetIndex === -1) {
        return Effect.fail(new VaultEnvVarError({ message: 'The EnvVar to edit no longer exists.' }))
      }
      if (profile.envVars.some((candidate, index) => index !== targetIndex && candidate.key === key)) {
        return Effect.fail(new VaultEnvVarError({ message: `EnvVar key "${key}" already exists.` }))
      }
      const next = [...profile.envVars]
      if (targetIndex === -1) next.push(saved)
      else next[targetIndex] = saved
      return Effect.succeed({ ...profile, envVars: next })
    })
    return saved
  })

export const deleteVaultEnvVar = (
  projectId: string,
  target: string | { readonly key: string; readonly occurrence?: number },
  profileName?: string,
) =>
  Effect.gen(function* () {
    const vault = yield* Vault
    const key = typeof target === 'string' ? target.trim() : target.key.trim()
    const occurrence = typeof target === 'string' ? 0 : target.occurrence ?? 0
    let deleted = false
    yield* updateProfile(vault, projectId, profileName, (profile) => {
      const index = findOccurrenceIndex(profile.envVars, key, occurrence)
      if (index === -1) return Effect.succeed(profile)
      deleted = true
      return Effect.succeed({ ...profile, envVars: profile.envVars.filter((_, candidateIndex) => candidateIndex !== index) })
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
    yield* updateProfile(vault, project.id, undefined, (profile) => Effect.succeed({ ...profile, envVars }))
    const deleteSourceFile = options.deleteSourceFile === true
    if (deleteSourceFile) yield* fs.remove(envFile)
    return { importedCount: envVars.length, deletedSourceFile: deleteSourceFile }
  })

/** Imports pasted .env content directly into the encrypted local Profile. */
export const importProjectEnvContent = (project: Project, content: string) =>
  Effect.gen(function* () {
    const envVars = parseEnvVars(content)
    const vault = yield* Vault
    yield* updateProfile(vault, project.id, undefined, (profile) => Effect.succeed({ ...profile, envVars }))
    return { importedCount: envVars.length }
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
