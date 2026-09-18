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
} from '../core/index.ts'
import {
  deleteEnvVar,
  DuplicateEnvVarKeyError,
  LinkWorktreeConflictError,
  listEnvVars,
  listProjects,
  discoverWorktrees,
  loadWorktreeMetadata,
  linkWorktree,
  registerProject,
  forceRemoveWorktree,
  removeProject,
  removeWorktree,
  run,
  setEnvVar,
} from '../core/index.ts'
import { DeleteEnvVarConfirmation } from './components/DeleteEnvVarConfirmation.tsx'
import { DeleteWorktreeConfirmation } from './components/DeleteWorktreeConfirmation.tsx'
import { EnvVarEditorModal } from './components/EnvVarEditorModal.tsx'
import type { EnvVarEditorValidationError } from './components/EnvVarEditorModal.tsx'
import { LinkWorktreeConfirmation } from './components/LinkWorktreeConfirmation.tsx'
import { MainPane } from './components/MainPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
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
  const [worktreeLink, setWorktreeLink] = useState<LinkWorktreeConflictError | null>(null)
  const [worktreeLinkInFlight, setWorktreeLinkInFlight] = useState(false)
  const [lastOpenWorktreeTarget, setLastOpenWorktreeTarget] = useState<WorktreeOpenTarget | null>(null)
  const selectedProjectIdRef = useRef<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    run(listProjects).then(setProjects)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2500)
    return () => clearTimeout(id)
  }, [toastMessage])

  const selectedProject = projects.find((project) => project.id === selectedId) ?? null
  const selectedCentralEnvFile = selectedProject?.centralEnvFile ?? null
  selectedProjectIdRef.current = selectedProject?.id ?? null

  useEffect(() => {
    setRevealedKeys(new Set())
    setEnvVarSearchQuery('')
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setWorktreeDelete(null)
    setWorktreeLink(null)
    if (!selectedProject || !selectedCentralEnvFile) {
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
    run(listEnvVars(selectedCentralEnvFile)).then((vars) => {
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
  }, [selectedCentralEnvFile, selectedProject, worktreeRefreshVersion])

  useEffect(() => {
    if (registrationInFlight || registrationQueue.length === 0) return
    const folderPath = registrationQueue[0]!
    setRegistrationQueue((current) => current.slice(1))
    setRegistrationInFlight(true)
    run(registerProject({ folderPath }))
      .then((project) => setProjects((current) => [...current, project]))
      .catch(() => undefined)
      .finally(() => setRegistrationInFlight(false))
  }, [registrationInFlight, registrationQueue])

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

  const handleStartAddEnvVar = () => {
    if (!selectedProject || registrationInFlight) return
    setEnvVarDelete(null)
    setEnvVarEditor({ mode: 'add', index: null, originalKey: null, key: '', value: '', validationError: null })
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
    if (!envVarEditor || !selectedCentralEnvFile || envVarSaveInFlight) return

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
    run(
      Effect.either(
        setEnvVar(
          selectedCentralEnvFile,
          { key, value: envVarEditor.value },
          envVarEditor.mode === 'edit' && envVarEditor.originalKey !== null
            ? { previousKey: envVarEditor.originalKey, occurrence }
            : undefined,
        ),
      ),
    )
      .then((result) => {
        if (result._tag === 'Left') {
          if (result.left instanceof DuplicateEnvVarKeyError) {
            const message = 'Duplicate EnvVar key "' + key + '" already exists'
            setEnvVarEditorValidationError({ field: 'key', message })
            setToastMessage(message)
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
    if (!envVarDelete || !selectedCentralEnvFile || envVarDeleteInFlight) return

    const occurrence = envVars
      .slice(0, envVarDelete.index)
      .filter((envVar) => envVar.key === envVarDelete.envVar.key).length
    const deletedKey = envVarDelete.envVar.key
    setEnvVarDeleteInFlight(true)
    run(deleteEnvVar(selectedCentralEnvFile, { key: deletedKey, occurrence }))
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

  const finishWorktreeLink = (project: Project, worktreePath: string, backupPath: string | null) => {
    const updateLinked = (current: Worktree[]) =>
      current.map((worktree) =>
        worktree.path === worktreePath
          ? { ...worktree, linked: true, hasRealEnvFile: false }
          : worktree,
      )
    const cacheEntry = worktreeCache.current.get(project.id)
    if (cacheEntry) writeWorktreeCache(worktreeCache.current, project.id, updateLinked(cacheEntry.worktrees), cacheEntry.loadedAt)
    if (selectedProjectIdRef.current !== project.id) return
    setWorktrees(updateLinked)
    setWorktreeLink(null)
    setToastMessage(backupPath ? 'Linked Worktree and backed up its existing .env' : 'Linked Worktree')
  }

  const performWorktreeLink = (project: Project, worktreePath: string, force: boolean) => {
    setWorktreeLinkInFlight(true)
    run(Effect.either(linkWorktree(project, worktreePath, force ? { force: true } : {})))
      .then((result) => {
        if (result._tag === 'Left') {
          if (result.left instanceof LinkWorktreeConflictError) {
            if (selectedProjectIdRef.current === project.id) setWorktreeLink(result.left)
          } else {
            if (selectedProjectIdRef.current === project.id) setToastMessage('Could not link Worktree')
          }
          return
        }
        finishWorktreeLink(project, worktreePath, result.right.backupPath)
      })
      .catch(() => {
        if (selectedProjectIdRef.current === project.id) setToastMessage('Could not link Worktree')
      })
      .finally(() => setWorktreeLinkInFlight(false))
  }

  const handleLinkWorktree = (worktreePath: string) => {
    if (!selectedProject || registrationInFlight || worktreeLinkInFlight) return
    if (!worktrees.some((worktree) => worktree.path === worktreePath)) return
    performWorktreeLink(selectedProject, worktreePath, false)
  }

  const handleLinkWorktreeAnyway = () => {
    if (!worktreeLink || !selectedProject || worktreeLinkInFlight) return
    const worktreePath = worktreeLink.worktreePath
    if (!worktrees.some((worktree) => worktree.path === worktreePath)) {
      setWorktreeLink(null)
      return
    }
    performWorktreeLink(selectedProject, worktreePath, true)
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
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    setWorktreeLink(null)
  }

  const handleStartRemove = () => {
    if (!selectedProject || registrationInFlight) return
    setRemovalMode('copy')
    setRemoveCandidateId(selectedProject.id)
  }

  const handleCancelRemove = () => {
    if (!removalInFlight) setRemoveCandidateId(null)
  }

  const handleRemoveProject = () => {
    if (!removeCandidateId || registrationInFlight || removalInFlight) return
    const projectId = removeCandidateId
    setRemovalInFlight(true)
    run(removeProject(projectId, removalMode))
      .then((removed) => {
        if (!removed) return
        setProjects((current) => current.filter((project) => project.id !== projectId))
        setSelectedId((current) => (current === projectId ? null : current))
        setRemoveCandidateId(null)
      })
      .catch(() => undefined)
      .finally(() => setRemovalInFlight(false))
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
        <TopBar selectedProject={selectedProject} onToggleSidebar={() => setCollapsed((current) => !current)} onAddProject={handleBrowse} />

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
            removalInFlight={removalInFlight}
            onFileDrop={handleFileDrop}
            onToggleReveal={handleToggleReveal}
            onCopy={handleCopyEnvVar}
            onSearchQueryChange={setEnvVarSearchQuery}
            onStartAdd={handleStartAddEnvVar}
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
            onLinkWorktree={handleLinkWorktree}
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

        {worktreeLink ? (
          <LinkWorktreeConfirmation
            conflict={worktreeLink}
            linking={worktreeLinkInFlight}
            onCancel={() => {
              if (!worktreeLinkInFlight) setWorktreeLink(null)
            }}
            onLinkAnyway={handleLinkWorktreeAnyway}
          />
        ) : null}

        {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
      </div>
    </TooltipProvider>
  )
}
