import { TooltipProvider } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Effect } from 'effect'
import type {
  EnvVar,
  Project,
  ProjectRemovalMode,
  Worktree,
  WorktreeMetadata,
  WorktreeRemovalFailure,
  VaultStatus,
} from '../core/index.ts'
import {
  deleteEnvVar,
  DuplicateEnvVarKeyError,
  listEnvVars,
  discoverWorktrees,
  loadWorktreeMetadata,
  forceRemoveWorktree,
  removeProject,
  removeWorktree,
  run,
  setEnvVar,
  Vault,
  deleteVaultEnvVar,
  importProjectEnvContent,
  importProjectEnvFile,
  listVaultEnvVars,
  listVaultProjects,
  registerVaultProject,
  removeVaultProject,
  serializeEnvVars,
  setVaultEnvVar,
  VaultEnvVarError,
} from '../core/index.ts'
import { DeleteEnvVarConfirmation } from './components/DeleteEnvVarConfirmation.tsx'
import { LockVaultConfirmation } from './components/LockVaultConfirmation.tsx'
import { DeleteWorktreeConfirmation } from './components/DeleteWorktreeConfirmation.tsx'
import { EnvContentImportModal } from './components/EnvContentImportModal.tsx'
import { EnvExportModal } from './components/EnvExportModal.tsx'
import { EnvVarEditorModal } from './components/EnvVarEditorModal.tsx'
import type { EnvVarEditorValidationError } from './components/EnvVarEditorModal.tsx'
import { EnvImportModal } from './components/EnvImportModal.tsx'
import { MainPane } from './components/MainPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { VaultGate } from './components/VaultGate.tsx'
import { C, DEFAULT_SIDEBAR_WIDTH } from './theme.ts'
import { copyToClipboard } from './utils/clipboard.ts'
import {
  openWorktree,
  type WorktreeOpenTarget,
} from './utils/openWorktree.ts'
import { pickFolderNative } from './utils/pickFolder.ts'
import { readWorktreeCache, type WorktreeCache, writeWorktreeCache } from './worktreeCache.ts'

interface EnvVarEditorState {
  readonly mode: 'add' | 'edit'
  readonly index: number | null
  readonly originalKey: string | null
  readonly key: string
  readonly value: string
  readonly validationError: EnvVarEditorValidationError | null
}

interface EnvVarDeleteState {
  readonly index: number
  readonly envVar: EnvVar
}

interface WorktreeDeleteState {
  readonly path: string
  readonly error: WorktreeRemovalFailure | null
}

interface EnvImportState {
  readonly project: Project
  readonly busy: boolean
  readonly error: string | null
}

interface EnvContentImportState {
  readonly content: string
  readonly busy: boolean
  readonly error: string | null
}

interface EnvExportState {
  readonly content: string
  readonly copied: boolean
}

const VAULT_RECHECK_MS = 30_000

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [registrationQueue, setRegistrationQueue] = useState<string[]>([])
  const [registrationInFlight, setRegistrationInFlight] = useState(false)
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null)
  const [removalMode, setRemovalMode] = useState<ProjectRemovalMode>('copy')
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [removalInFlight, setRemovalInFlight] = useState(false)
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [worktreesLoading, setWorktreesLoading] = useState(false)
  const [worktreesRefreshing, setWorktreesRefreshing] = useState(false)
  const worktreeCache = useRef<WorktreeCache>(new Map())
  const worktreeDiscoveryRequests = useRef(new Map<string, Promise<Worktree[]>>())
  const worktreeMetadataRequests = useRef(new Map<string, Promise<WorktreeMetadata>>())
  const worktreeRefreshProjectRef = useRef<string | null>(null)
  const [worktreeRefreshVersion, setWorktreeRefreshVersion] = useState(0)
  const [envVarSearchQuery, setEnvVarSearchQuery] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [envVarEditor, setEnvVarEditor] = useState<EnvVarEditorState | null>(null)
  const [envVarSaveInFlight, setEnvVarSaveInFlight] = useState(false)
  const [envVarDelete, setEnvVarDelete] = useState<EnvVarDeleteState | null>(null)
  const [envVarDeleteInFlight, setEnvVarDeleteInFlight] = useState(false)
  const [worktreeDelete, setWorktreeDelete] = useState<WorktreeDeleteState | null>(null)
  const [worktreeDeleteInFlight, setWorktreeDeleteInFlight] = useState(false)
  const [worktreeForceDeleteInFlight, setWorktreeForceDeleteInFlight] = useState(false)
  const [lastOpenWorktreeTarget, setLastOpenWorktreeTarget] = useState<WorktreeOpenTarget | null>(null)
  const selectedProjectIdRef = useRef<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | 'unavailable' | 'loading'>('loading')
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false)
  const [lockInFlight, setLockInFlight] = useState(false)
  const [vaultCheckVersion, setVaultCheckVersion] = useState(0)
  const [envImport, setEnvImport] = useState<EnvImportState | null>(null)
  const [envContentImport, setEnvContentImport] = useState<EnvContentImportState | null>(null)
  const [envExport, setEnvExport] = useState<EnvExportState | null>(null)

  useEffect(() => {
    if (vaultStatus !== 'unlocked') return
    run(listVaultProjects).then(setProjects).catch(() => setVaultError('Could not load Projects from the Vault.'))
  }, [vaultStatus])

  useEffect(() => {
    let stale = false
    run(
      Effect.gen(function* () {
        const vault = yield* Vault
        return yield* vault.status()
      }),
    )
      .then((status) => {
        if (!stale) {
          setVaultError(null)
          setVaultStatus(status)
        }
      })
      .catch(() => {
        if (!stale) {
          setVaultError('Could not access the local Vault.')
          setVaultStatus('unavailable')
        }
      })
    return () => {
      stale = true
    }
  }, [vaultCheckVersion])

  // The key can expire or be locked from the CLI while the window stays open.
  useEffect(() => {
    const id = setInterval(() => setVaultCheckVersion((version) => version + 1), VAULT_RECHECK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2500)
    return () => clearTimeout(id)
  }, [toastMessage])

  const selectedProject = projects.find((project) => project.id === selectedId) ?? null
  const selectedCentralEnvFile = selectedProject?.centralEnvFile ?? null
  selectedProjectIdRef.current = selectedProject?.id ?? null

  const handleCreateVault = (password: string) => {
    if (vaultBusy) return
    setVaultBusy(true)
    setVaultError(null)
    run(
      Effect.gen(function* () {
        const vault = yield* Vault
        yield* vault.initialize(password)
      }),
    )
      .then(() => setVaultStatus('unlocked'))
      .catch(() => setVaultError('Could not create the Vault.'))
      .finally(() => setVaultBusy(false))
  }

  const handleUnlockVault = (password: string) => {
    if (vaultBusy) return
    setVaultBusy(true)
    setVaultError(null)
    run(
      Effect.gen(function* () {
        const vault = yield* Vault
        yield* vault.unlock(password)
      }),
    )
      .then(() => setVaultStatus('unlocked'))
      .catch(() => setVaultError('The Vault password was rejected.'))
      .finally(() => setVaultBusy(false))
  }

  // The Vault can be locked elsewhere (CLI, expiry) while the dialog is open.
  useEffect(() => {
    if (vaultStatus !== 'unlocked') setLockConfirmOpen(false)
  }, [vaultStatus])

  // Locking hands back to the gate below, which is where the Vault is unlocked again.
  const handleConfirmLockVault = () => {
    if (lockInFlight) return
    setLockInFlight(true)
    run(
      Effect.gen(function* () {
        const vault = yield* Vault
        yield* vault.lock()
      }),
    )
      .then(() => setVaultStatus('locked'))
      .catch(() => setToastMessage('Could not lock the Vault'))
      .finally(() => {
        setLockInFlight(false)
        setLockConfirmOpen(false)
      })
  }

  useEffect(() => {
    setRevealedKeys(new Set())
    setEnvVarSearchQuery('')
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setWorktreeDelete(null)
    setEnvContentImport(null)
    setEnvExport(null)
    setRemovalError(null)
    if (vaultStatus !== 'unlocked' || !selectedProject || (!selectedProject.vaultBacked && !selectedCentralEnvFile)) {
      setEnvVars([])
      setWorktrees([])
      setWorktreesLoading(false)
      setWorktreesRefreshing(false)
      return
    }
    const project = selectedProject
    const cached = readWorktreeCache(worktreeCache.current, project.id)
    const forceRefresh = worktreeRefreshProjectRef.current === project.id
    if (forceRefresh) worktreeRefreshProjectRef.current = null
    setWorktrees(cached?.worktrees ?? [])
    setWorktreesLoading(cached === null)
    setWorktreesRefreshing(forceRefresh || cached?.stale === true)
    // Guard against a stale response landing after the user has already
    // switched to (or back to) a different Project.
    let stale = false
    const envVarsRequest = project.vaultBacked
      ? run(listVaultEnvVars(project.id))
      : run(listEnvVars(selectedCentralEnvFile!))
    envVarsRequest.then((vars) => {
      if (!stale) setEnvVars(vars)
    })
    const applyMetadata = (worktree: Worktree, metadata: WorktreeMetadata) => {
      const cacheEntry = worktreeCache.current.get(project.id)
      const snapshot = cacheEntry?.worktrees ?? [worktree]
      const next = snapshot.map((current) =>
        current.path === worktree.path ? { ...current, metadata } : current,
      )
      writeWorktreeCache(worktreeCache.current, project.id, next, cacheEntry?.loadedAt)
      if (!stale) {
        setWorktrees((current) =>
          current.map((item) => (item.path === worktree.path ? { ...item, metadata } : item)),
        )
      }
    }

    const loadMetadata = (discovered: Worktree[]) => {
      for (const worktree of discovered) {
        if (worktree.metadata !== null) continue
        const requestKey = `${project.id}:${worktree.path}`
        const existing = worktreeMetadataRequests.current.get(requestKey)
        const request = existing ?? run(loadWorktreeMetadata(worktree))
        if (!existing) {
          worktreeMetadataRequests.current.set(requestKey, request)
          const clearRequest = () => {
            if (worktreeMetadataRequests.current.get(requestKey) === request) {
              worktreeMetadataRequests.current.delete(requestKey)
            }
          }
          request.then(clearRequest, clearRequest)
        }
        request.then((metadata) => applyMetadata(worktree, metadata)).catch(() => undefined)
      }
    }

    if (cached && !cached.stale && !forceRefresh) {
      loadMetadata(cached.worktrees)
      return () => {
        stale = true
      }
    }

    const existing = worktreeDiscoveryRequests.current.get(project.id)
    const request = existing ?? run(discoverWorktrees(project))
    if (!existing) {
      worktreeDiscoveryRequests.current.set(project.id, request)
      const clearRequest = () => {
        if (worktreeDiscoveryRequests.current.get(project.id) === request) {
          worktreeDiscoveryRequests.current.delete(project.id)
        }
      }
      request.then(clearRequest, clearRequest)
    }

    request
      .then((discovered) => {
        const previous = worktreeCache.current.get(project.id)
        const previousByPath = new Map(previous?.worktrees.map((worktree) => [worktree.path, worktree]) ?? [])
        const next = discovered.map((worktree) => ({
          ...worktree,
          metadata: previousByPath.get(worktree.path)?.metadata ?? null,
        }))
        writeWorktreeCache(worktreeCache.current, project.id, next, Date.now())
        if (!stale) {
          setWorktrees(next)
          setWorktreesLoading(false)
          setWorktreesRefreshing(false)
        }
        loadMetadata(next)
      })
      .catch(() => {
        if (!stale) {
          if (!cached) setWorktrees([])
          setWorktreesLoading(false)
          setWorktreesRefreshing(false)
        }
      })
    return () => {
      stale = true
    }
  }, [selectedCentralEnvFile, selectedProject, vaultStatus, worktreeRefreshVersion])

  useEffect(() => {
    if (vaultStatus !== 'unlocked' || registrationInFlight || registrationQueue.length === 0) return
    const folderPath = registrationQueue[0]!
    setRegistrationQueue((current) => current.slice(1))
    setRegistrationInFlight(true)
    run(registerVaultProject({ folderPath }))
      .then(({ project, envFileFound }) => {
        setProjects((current) => [...current, project])
        setSelectedId(project.id)
        if (envFileFound) setEnvImport({ project, busy: false, error: null })
      })
      .catch(() => undefined)
      .finally(() => setRegistrationInFlight(false))
  }, [registrationInFlight, registrationQueue, vaultStatus])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (project) => project.name.toLowerCase().includes(q) || project.folderPath.toLowerCase().includes(q),
    )
  }, [projects, query])

  // A Central env file can genuinely have the same key written twice (hand
  // edited outside Raphie); flag every instance rather than silently
  // dropping one, since which value "wins" isn't ours to decide here.
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const envVar of envVars) counts.set(envVar.key, (counts.get(envVar.key) ?? 0) + 1)
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key))
  }, [envVars])

  const handleCopyEnvVar = (envVar: EnvVar) => {
    copyToClipboard(envVar.value)
    setToastMessage(`Copied ${envVar.key} to clipboard`)
  }

  const handleToggleReveal = (key: string) =>
    setRevealedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleToggleRevealAll = () => {
    const allRevealed = envVars.length > 0 && envVars.every((envVar) => revealedKeys.has(envVar.key))
    setRevealedKeys(allRevealed ? new Set() : new Set(envVars.map((envVar) => envVar.key)))
  }

  const handleStartAddEnvVar = () => {
    if (!selectedProject || registrationInFlight) return
    setEnvContentImport(null)
    setEnvExport(null)
    setEnvVarDelete(null)
    setEnvVarEditor({ mode: 'add', index: null, originalKey: null, key: '', value: '', validationError: null })
  }

  const handleStartImportEnv = () => {
    if (!selectedProject?.vaultBacked || registrationInFlight) return
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setEnvExport(null)
    setEnvContentImport({ content: '', busy: false, error: null })
  }

  const handleStartExport = () => {
    if (!selectedProject?.vaultBacked || registrationInFlight) return
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setEnvContentImport(null)
    setEnvExport({ content: serializeEnvVars(envVars), copied: false })
  }

  const handleCopyExport = () => {
    if (!envExport || envExport.content.length === 0) return
    void copyToClipboard(envExport.content)
    setEnvExport((current) => (current ? { ...current, copied: true } : current))
    setToastMessage('Copied all EnvVars to clipboard')
  }

  const handleImportEnvContent = () => {
    if (!envContentImport || envContentImport.busy || !selectedProject?.vaultBacked) return
    if (!envContentImport.content.trim()) {
      setEnvContentImport((current) => (current ? { ...current, error: 'Paste Env Var contents to import.' } : current))
      return
    }

    const project = selectedProject
    setEnvContentImport((current) => (current ? { ...current, busy: true, error: null } : current))
    run(importProjectEnvContent(project, envContentImport.content))
      .then((result) => {
        if (selectedProjectIdRef.current === project.id) {
          setRevealedKeys(new Set())
          run(listVaultEnvVars(project.id)).then(setEnvVars).catch(() => undefined)
        }
        setEnvContentImport(null)
        setToastMessage(`Imported ${result.importedCount} EnvVars`)
      })
      .catch(() =>
        setEnvContentImport((current) =>
          current ? { ...current, busy: false, error: 'Could not import Env Vars.' } : current,
        ),
      )
  }

  const handleImportProjectEnv = (deleteSourceFile: boolean) => {
    if (!envImport || envImport.busy) return
    const project = envImport.project
    setEnvImport({ ...envImport, busy: true, error: null })
    run(importProjectEnvFile(project, { deleteSourceFile }))
      .then((result) => {
        if (selectedProjectIdRef.current === project.id) {
          setRevealedKeys(new Set())
          run(listVaultEnvVars(project.id)).then(setEnvVars).catch(() => undefined)
        }
        setEnvImport(null)
        setToastMessage(
          deleteSourceFile
            ? `Imported ${result.importedCount} EnvVars and deleted .env`
            : `Imported ${result.importedCount} EnvVars`,
        )
      })
      .catch(() => setEnvImport((current) => (current ? { ...current, busy: false, error: 'Could not import .env.' } : current)))
  }

  const handleStartEditEnvVar = (index: number) => {
    const envVar = envVars[index]
    if (!selectedProject || !envVar || registrationInFlight) return
    setEnvVarDelete(null)
    setEnvVarEditor({
      mode: 'edit',
      index,
      originalKey: envVar.key,
      key: envVar.key,
      value: envVar.value,
      validationError: null,
    })
  }

  const handleStartDeleteEnvVar = (index: number) => {
    const envVar = envVars[index]
    if (!selectedProject || !envVar || registrationInFlight) return
    setEnvVarEditor(null)
    setEnvVarDelete({ index, envVar })
  }

  const handleStartDeleteWorktree = (path: string) => {
    if (!selectedProject || registrationInFlight || worktreeDeleteInFlight) return
    if (path === selectedProject.folderPath || !worktrees.some((worktree) => worktree.path === path)) return
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setWorktreeDelete({ path, error: null })
  }

  const handleRefreshWorktrees = () => {
    if (!selectedProject || registrationInFlight || worktreesRefreshing) return
    worktreeRefreshProjectRef.current = selectedProject.id
    setWorktreesRefreshing(true)
    setWorktreeRefreshVersion((current) => current + 1)
  }

  const setEnvVarEditorValidationError = (validationError: EnvVarEditorValidationError) => {
    setEnvVarEditor((current) => (current ? { ...current, validationError } : current))
  }

  const handleSaveEnvVar = () => {
    if (!envVarEditor || !selectedProject || (!selectedProject.vaultBacked && !selectedCentralEnvFile) || envVarSaveInFlight) return

    const key = envVarEditor.key.trim()
    const duplicate = envVars.some((envVar, index) => index !== envVarEditor.index && envVar.key === key)
    if (duplicate) {
      const message = 'Duplicate EnvVar key "' + key + '" already exists'
      setEnvVarEditorValidationError({ field: 'key', message })
      setToastMessage(message)
      return
    }
    if (!key) {
      setEnvVarEditorValidationError({ field: 'key', message: 'EnvVar key cannot be empty' })
      return
    }
    if (!envVarEditor.value.trim()) {
      setEnvVarEditorValidationError({ field: 'value', message: 'EnvVar value cannot be empty' })
      return
    }

    const occurrence =
      envVarEditor.index === null || envVarEditor.originalKey === null
        ? undefined
        : envVars.slice(0, envVarEditor.index).filter((envVar) => envVar.key === envVarEditor.originalKey).length

    setEnvVarSaveInFlight(true)
    const saveResult = selectedProject.vaultBacked
      ? run(
          Effect.either(
            setVaultEnvVar(
              selectedProject.id,
              { key, value: envVarEditor.value },
              envVarEditor.mode === 'edit' && envVarEditor.originalKey !== null
                ? { previousKey: envVarEditor.originalKey, occurrence }
                : undefined,
            ),
          ),
        )
      : run(
          Effect.either(
            setEnvVar(
              selectedCentralEnvFile!,
              { key, value: envVarEditor.value },
              envVarEditor.mode === 'edit' && envVarEditor.originalKey !== null
                ? { previousKey: envVarEditor.originalKey, occurrence }
                : undefined,
            ),
          ),
        )
    saveResult
      .then((result) => {
        if (result._tag === 'Left') {
          if (result.left instanceof DuplicateEnvVarKeyError) {
            const message = 'Duplicate EnvVar key "' + key + '" already exists'
            setEnvVarEditorValidationError({ field: 'key', message })
            setToastMessage(message)
          } else if (result.left instanceof VaultEnvVarError) {
            setEnvVarEditorValidationError({ field: 'key', message: result.left.message })
            setToastMessage(result.left.message)
          } else {
            setToastMessage('Could not save EnvVar')
          }
          return
        }

        const saved = result.right
        setEnvVars((current) =>
          envVarEditor.index === null
            ? [...current, saved]
            : current.map((envVar, index) => (index === envVarEditor.index ? saved : envVar)),
        )
        setEnvVarEditor(null)
        setToastMessage('Saved ' + saved.key)
      })
      .catch(() => setToastMessage('Could not save EnvVar'))
      .finally(() => setEnvVarSaveInFlight(false))
  }

  const handleCancelDeleteEnvVar = () => {
    if (!envVarDeleteInFlight) setEnvVarDelete(null)
  }

  const handleConfirmDeleteEnvVar = () => {
    if (!envVarDelete || !selectedProject || (!selectedProject.vaultBacked && !selectedCentralEnvFile) || envVarDeleteInFlight) return

    const occurrence = envVars
      .slice(0, envVarDelete.index)
      .filter((envVar) => envVar.key === envVarDelete.envVar.key).length
    const deletedKey = envVarDelete.envVar.key
    setEnvVarDeleteInFlight(true)
    const deleteResult = selectedProject.vaultBacked
      ? run(deleteVaultEnvVar(selectedProject.id, { key: deletedKey, occurrence }))
      : run(deleteEnvVar(selectedCentralEnvFile!, { key: deletedKey, occurrence }))
    deleteResult
      .then((deleted) => {
        if (!deleted) {
          setToastMessage('Could not delete ' + deletedKey)
          return
        }
        setEnvVars((current) => current.filter((_, index) => index !== envVarDelete.index))
        setEnvVarDelete(null)
        setToastMessage('Deleted ' + deletedKey)
      })
      .catch(() => setToastMessage('Could not delete ' + deletedKey))
      .finally(() => setEnvVarDeleteInFlight(false))
  }

  const handleCancelDeleteWorktree = () => {
    if (!worktreeDeleteInFlight) setWorktreeDelete(null)
  }

  const finishWorktreeDeletion = (project: Project, worktreePath: string, message: string) => {
    const cacheEntry = worktreeCache.current.get(project.id)
    if (cacheEntry) {
      writeWorktreeCache(
        worktreeCache.current,
        project.id,
        cacheEntry.worktrees.filter((worktree) => worktree.path !== worktreePath),
        cacheEntry.loadedAt,
      )
    }
    if (selectedProjectIdRef.current === project.id) {
      setWorktrees((current) => current.filter((worktree) => worktree.path !== worktreePath))
    }
    setWorktreeDelete(null)
    setToastMessage(message)
  }

  const handleConfirmDeleteWorktree = () => {
    if (!worktreeDelete || !selectedProject || worktreeDeleteInFlight) return
    const project = selectedProject
    const worktreePath = worktreeDelete.path
    setWorktreeDelete((current) => (current ? { ...current, error: null } : current))
    setWorktreeForceDeleteInFlight(false)
    setWorktreeDeleteInFlight(true)
    run(removeWorktree(project, worktreePath))
      .then((result) => {
        if (!result.removed) {
          setWorktreeDelete((current) => (current ? { ...current, error: result.error } : current))
          return
        }

        finishWorktreeDeletion(project, worktreePath, 'Deleted Worktree and its files')
      })
      .catch((error) => {
        setWorktreeDelete((current) =>
          current
            ? {
                ...current,
                error: {
                  code: 'unknown',
                  message: 'An unexpected error prevented Git from deleting this Worktree.',
                  detail: error instanceof Error ? error.message : String(error),
                },
              }
            : current,
        )
      })
      .finally(() => {
        setWorktreeDeleteInFlight(false)
        setWorktreeForceDeleteInFlight(false)
      })
  }

  const handleForceDeleteWorktree = () => {
    if (!worktreeDelete?.error || !selectedProject || worktreeDeleteInFlight) return
    const project = selectedProject
    const worktreePath = worktreeDelete.path
    setWorktreeDelete((current) => (current ? { ...current, error: null } : current))
    setWorktreeForceDeleteInFlight(true)
    setWorktreeDeleteInFlight(true)
    run(forceRemoveWorktree(project, worktreePath))
      .then((result) => {
        if (!result.removed) {
          setWorktreeDelete((current) => (current ? { ...current, error: result.error } : current))
          return
        }

        finishWorktreeDeletion(project, worktreePath, 'Force deleted Worktree and pruned Git metadata')
      })
      .catch((error) => {
        setWorktreeDelete((current) =>
          current
            ? {
                ...current,
                error: {
                  code: 'unknown',
                  message: 'An unexpected error prevented the Worktree folder from being force deleted.',
                  detail: error instanceof Error ? error.message : String(error),
                },
              }
            : current,
        )
      })
      .finally(() => {
        setWorktreeDeleteInFlight(false)
        setWorktreeForceDeleteInFlight(false)
      })
  }

  const queueFolders = (folderPaths: string[]) => {
    const paths = folderPaths.filter(Boolean)
    if (paths.length === 0) return
    setRegistrationQueue((current) => [...current, ...paths])
  }

  const handleFileDrop = (event: { paths?: string[] }) => queueFolders(event.paths ?? [])

  const handleBrowse = () => {
    pickFolderNative().then((folderPath) => {
      if (folderPath) queueFolders([folderPath])
    })
  }

  const handleOpenWorktree = (path: string, target: WorktreeOpenTarget) => {
    if (openWorktree(target, path)) {
      setLastOpenWorktreeTarget(target)
      return
    }
    setToastMessage('Could not open Worktree')
  }

  const handleSelectOpenWorktreeTarget = (target: WorktreeOpenTarget) => {
    setLastOpenWorktreeTarget(target)
  }

  const handleSelectProject = (id: string) => {
    setSelectedId(id)
    setRemoveCandidateId(null)
    setRemovalError(null)
    setEnvVarEditor(null)
    setEnvVarDelete(null)
  }

  const handleStartRemove = () => {
    if (!selectedProject || registrationInFlight) return
    setRemovalMode('copy')
    setRemovalError(null)
    setRemoveCandidateId(selectedProject.id)
  }

  const handleCancelRemove = () => {
    if (!removalInFlight) {
      setRemoveCandidateId(null)
      setRemovalError(null)
    }
  }

  const handleRemoveProject = () => {
    if (!removeCandidateId || registrationInFlight || removalInFlight) return
    const projectId = removeCandidateId
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    setRemovalError(null)
    setRemovalInFlight(true)
    const removeResult = project.vaultBacked
      ? run(Effect.either(removeVaultProject(projectId)))
      : run(Effect.either(removeProject(projectId, removalMode)))
    removeResult
      .then((result) => {
        if (result._tag === 'Left') {
          setRemovalError('Could not remove the Project.')
          return
        }
        if (!result.right) {
          setRemovalError('Could not remove the Project.')
          return
        }
        setProjects((current) => current.filter((project) => project.id !== projectId))
        setSelectedId((current) => (current === projectId ? null : current))
        setRemoveCandidateId(null)
      })
      .catch(() => setRemovalError('Could not remove the Project.'))
      .finally(() => setRemovalInFlight(false))
  }

  if (vaultStatus !== 'unlocked') {
    return (
      <VaultGate
        status={vaultStatus}
        busy={vaultBusy}
        error={vaultError}
        onCreate={handleCreateVault}
        onUnlock={handleUnlockVault}
        onRetry={() => {
          setVaultError(null)
          setVaultStatus('loading')
          setVaultCheckVersion((current) => current + 1)
        }}
      />
    )
  }

  return (
    <TooltipProvider>
      <div
        testId="app-root"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: C.canvas,
        }}
      >
        <TopBar
          selectedProject={selectedProject}
          onToggleSidebar={() => setCollapsed((current) => !current)}
          onAddProject={handleBrowse}
          onLockVault={() => setLockConfirmOpen(true)}
        />

        <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
          <Sidebar
            visibleProjects={visible}
            hasAnyProjects={projects.length > 0}
            query={query}
            onQueryChange={setQuery}
            selectedId={selectedId}
            onSelectProject={handleSelectProject}
            width={sidebarWidth}
            onResizeWidth={setSidebarWidth}
            collapsed={collapsed}
            onFileDrop={handleFileDrop}
          />

          <MainPane
            selectedProject={selectedProject}
            registrationInFlight={registrationInFlight}
            envVars={envVars}
            worktrees={worktrees}
            worktreesLoading={worktreesLoading}
            worktreesRefreshing={worktreesRefreshing}
            revealedKeys={revealedKeys}
            duplicateKeys={duplicateKeys}
            searchQuery={envVarSearchQuery}
            isRemoving={removeCandidateId === selectedProject?.id}
            removalMode={removalMode}
            removalError={removalError}
            removalInFlight={removalInFlight}
            onFileDrop={handleFileDrop}
            onToggleReveal={handleToggleReveal}
            onToggleRevealAll={handleToggleRevealAll}
            onCopy={handleCopyEnvVar}
            onSearchQueryChange={setEnvVarSearchQuery}
            onStartAdd={handleStartAddEnvVar}
            onStartImport={handleStartImportEnv}
            onStartExport={handleStartExport}
            onEdit={handleStartEditEnvVar}
            onDelete={handleStartDeleteEnvVar}
            onStartRemove={handleStartRemove}
            onSelectRemovalMode={setRemovalMode}
            onCancelRemove={handleCancelRemove}
            onConfirmRemove={handleRemoveProject}
            onOpenWorktree={handleOpenWorktree}
            lastOpenWorktreeTarget={lastOpenWorktreeTarget}
            onSelectOpenWorktreeTarget={handleSelectOpenWorktreeTarget}
            onDeleteWorktree={handleStartDeleteWorktree}
            onRefreshWorktrees={handleRefreshWorktrees}
          />
        </div>

        {envVarEditor ? (
          <EnvVarEditorModal
            mode={envVarEditor.mode}
            envVar={{ key: envVarEditor.key, value: envVarEditor.value }}
            validationError={envVarEditor.validationError}
            saving={envVarSaveInFlight}
            onKeyChange={(key) =>
              setEnvVarEditor((current) => (current ? { ...current, key, validationError: null } : current))
            }
            onValueChange={(value) =>
              setEnvVarEditor((current) => (current ? { ...current, value, validationError: null } : current))
            }
            onSave={handleSaveEnvVar}
            onClose={() => {
              if (!envVarSaveInFlight) setEnvVarEditor(null)
            }}
          />
        ) : null}

        {envImport ? (
          <EnvImportModal
            projectName={envImport.project.name}
            busy={envImport.busy}
            error={envImport.error}
            onSkip={() => {
              if (!envImport.busy) setEnvImport(null)
            }}
            onImport={handleImportProjectEnv}
          />
        ) : null}

        {envContentImport ? (
          <EnvContentImportModal
            content={envContentImport.content}
            busy={envContentImport.busy}
            error={envContentImport.error}
            onChange={(content) =>
              setEnvContentImport((current) => (current ? { ...current, content, error: null } : current))
            }
            onCancel={() => {
              if (!envContentImport.busy) setEnvContentImport(null)
            }}
            onImport={handleImportEnvContent}
          />
        ) : null}

        {envExport ? (
          <EnvExportModal
            content={envExport.content}
            copied={envExport.copied}
            onCopy={handleCopyExport}
            onClose={() => setEnvExport(null)}
          />
        ) : null}

        {lockConfirmOpen ? (
          <LockVaultConfirmation
            locking={lockInFlight}
            onCancel={() => setLockConfirmOpen(false)}
            onConfirm={handleConfirmLockVault}
          />
        ) : null}

        {envVarDelete ? (
          <DeleteEnvVarConfirmation
            envVar={envVarDelete.envVar}
            deleting={envVarDeleteInFlight}
            onCancel={handleCancelDeleteEnvVar}
            onConfirm={handleConfirmDeleteEnvVar}
          />
        ) : null}

        {worktreeDelete ? (
          <DeleteWorktreeConfirmation
            worktreePath={worktreeDelete.path}
            error={worktreeDelete.error}
            deleting={worktreeDeleteInFlight}
            forceDeleting={worktreeForceDeleteInFlight}
            onCancel={handleCancelDeleteWorktree}
            onConfirm={handleConfirmDeleteWorktree}
            onForceDelete={handleForceDeleteWorktree}
          />
        ) : null}

        {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
      </div>
    </TooltipProvider>
  )
}
