export type { EnvVar, Project, Worktree, WorktreeCommit, WorktreeMetadata } from './Domain.ts'
export { registerProject } from './registerProject.ts'
export { listProjects } from './listProjects.ts'
export {
  countLinkedWorktrees,
  discoverWorktrees,
  listWorktrees,
  loadWorktreeMetadata,
  WorktreeDiscoveryError,
} from './listWorktrees.ts'
export { forceLinkWorktree, linkWorktree, LinkWorktreeConflictError } from './linkWorktree.ts'
export type { LinkWorktreeOptions, LinkWorktreeResult } from './linkWorktree.ts'
export { InvalidWorktreeUnlinkModeError, unlinkWorktree, WorktreeNotLinkedError } from './unlinkWorktree.ts'
export type { WorktreeUnlinkMode } from './unlinkWorktree.ts'
export { forceRemoveWorktree, removeWorktree } from './removeWorktree.ts'
export type {
  RemoveWorktreeResult,
  WorktreeRemovalFailure,
  WorktreeRemovalFailureCode,
} from './removeWorktree.ts'
export { listEnvVars } from './listEnvVars.ts'
export {
  DuplicateEnvVarKeyError,
  InvalidEnvVarKeyError,
  MissingEnvVarError,
} from './setEnvVar.ts'
export { setEnvVar } from './setEnvVar.ts'
export { deleteEnvVar } from './deleteEnvVar.ts'
export type { DeleteEnvVarTarget } from './deleteEnvVar.ts'
export type { ParsedEnvVar, SetEnvVarOptions } from './envVarFile.ts'
export { ProjectHasLinkedWorktreesError, removeProject } from './removeProject.ts'
export type { ProjectRemovalMode } from './removeProject.ts'
export { run } from './runtime.ts'
export {
  Vault,
  VaultAlreadyInitializedError,
  VaultCorruptedError,
  VaultKeyMissingError,
  VaultKeyProviderError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultStorageError,
  makeVault,
} from './vault.ts'
export type {
  VaultError,
  VaultKeyProvider,
  VaultLockState,
  VaultRecord,
  VaultService,
  VaultStatus,
  VaultStorage,
} from './vault.ts'
export { VaultLive } from './vaultLive.ts'
