import { TooltipProvider } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Effect } from 'effect'
import type { EnvVar, Project, ProjectRemovalMode, Worktree, WorktreeMetadata } from '../core/index.ts'
import {
  deleteEnvVar,
  DuplicateEnvVarKeyError,
  listEnvVars,
  listProjects,
  discoverWorktrees,
  loadWorktreeMetadata,
  registerProject,
  removeProject,
  run,
  setEnvVar,
} from '../core/index.ts'
import { DeleteEnvVarConfirmation } from './components/DeleteEnvVarConfirmation.tsx'
import { EnvVarEditorModal } from './components/EnvVarEditorModal.tsx'
import type { EnvVarEditorValidationError } from './components/EnvVarEditorModal.tsx'
import { MainPane } from './components/MainPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { C, DEFAULT_SIDEBAR_WIDTH } from './theme.ts'
import { copyToClipboard } from './utils/clipboard.ts'
import {
  getOpenWorktreeOptions,
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
  const worktreeCache = useRef<WorktreeCache>(new Map())
  const worktreeDiscoveryRequests = useRef(new Map<string, Promise<Worktree[]>>())
  const worktreeMetadataRequests = useRef(new Map<string, Promise<WorktreeMetadata>>())
  const [envVarSearchQuery, setEnvVarSearchQuery] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [envVarEditor, setEnvVarEditor] = useState<EnvVarEditorState | null>(null)
  const [envVarSaveInFlight, setEnvVarSaveInFlight] = useState(false)
  const [envVarDelete, setEnvVarDelete] = useState<EnvVarDeleteState | null>(null)
  const [envVarDeleteInFlight, setEnvVarDeleteInFlight] = useState(false)
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

  useEffect(() => {
    setRevealedKeys(new Set())
    setEnvVarSearchQuery('')
    setEnvVarEditor(null)
    setEnvVarDelete(null)
    if (!selectedProject || !selectedCentralEnvFile) {
      setEnvVars([])
      setWorktrees([])
      setWorktreesLoading(false)
      return
    }
    const project = selectedProject
    const cached = readWorktreeCache(worktreeCache.current, project.id)
    setWorktrees(cached?.worktrees ?? [])
    setWorktreesLoading(cached === null)
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

    if (cached && !cached.stale) {
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
        }
        loadMetadata(next)
      })
      .catch(() => {
        if (!stale) {
          if (!cached) setWorktrees([])
          setWorktreesLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [selectedCentralEnvFile, selectedProject])

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
    if (openWorktree(target, path)) return
    const label = getOpenWorktreeOptions().find((option) => option.value === target)?.label ?? target
    setToastMessage(`Could not open Worktree in ${label}`)
  }

  const handleSelectProject = (id: string) => {
    setSelectedId(id)
    setRemoveCandidateId(null)
    setEnvVarEditor(null)
    setEnvVarDelete(null)
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

        {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
      </div>
    </TooltipProvider>
  )
}
