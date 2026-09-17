import { TooltipProvider } from '@gpuix/react'
import { useEffect, useMemo, useState } from 'react'
import { Effect } from 'effect'
import type { EnvVar, Project, ProjectRemovalMode } from '../core/index.ts'
import {
  deleteEnvVar,
  DuplicateEnvVarKeyError,
  listEnvVars,
  listProjects,
  registerProject,
  removeProject,
  run,
  setEnvVar,
} from '../core/index.ts'
import { DeleteEnvVarConfirmation } from './components/DeleteEnvVarConfirmation.tsx'
import { EnvVarEditorModal } from './components/EnvVarEditorModal.tsx'
import { MainPane } from './components/MainPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { C, DEFAULT_SIDEBAR_WIDTH } from './theme.ts'
import { copyToClipboard } from './utils/clipboard.ts'
import { pickFolderNative } from './utils/pickFolder.ts'

interface EnvVarEditorState {
  readonly mode: 'add' | 'edit'
  readonly index: number | null
  readonly originalKey: string | null
  readonly key: string
  readonly value: string
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
    if (!selectedCentralEnvFile) {
      setEnvVars([])
      return
    }
    // Guard against a stale response landing after the user has already
    // switched to (or back to) a different Project.
    let stale = false
    run(listEnvVars(selectedCentralEnvFile)).then((vars) => {
      if (!stale) setEnvVars(vars)
    })
    return () => {
      stale = true
    }
  }, [selectedCentralEnvFile])

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
    setEnvVarEditor({ mode: 'add', index: null, originalKey: null, key: '', value: '' })
  }

  const handleStartEditEnvVar = (index: number) => {
    const envVar = envVars[index]
    if (!selectedProject || !envVar || registrationInFlight) return
    setEnvVarDelete(null)
    setEnvVarEditor({ mode: 'edit', index, originalKey: envVar.key, key: envVar.key, value: envVar.value })
  }

  const handleStartDeleteEnvVar = (index: number) => {
    const envVar = envVars[index]
    if (!selectedProject || !envVar || registrationInFlight) return
    setEnvVarEditor(null)
    setEnvVarDelete({ index, envVar })
  }

  const handleSaveEnvVar = () => {
    if (!envVarEditor || !selectedCentralEnvFile || envVarSaveInFlight) return

    const key = envVarEditor.key.trim()
    const duplicate = envVars.some((envVar, index) => index !== envVarEditor.index && envVar.key === key)
    if (duplicate) {
      setToastMessage('Duplicate EnvVar key "' + key + '" already exists')
      return
    }
    if (!key) {
      setToastMessage('EnvVar key cannot be empty')
      return
    }
    if (!envVarEditor.value.trim()) {
      setToastMessage('EnvVar value cannot be empty')
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
            setToastMessage('Duplicate EnvVar key "' + key + '" already exists')
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
          />
        </div>

        {envVarEditor ? (
          <EnvVarEditorModal
            mode={envVarEditor.mode}
            envVar={{ key: envVarEditor.key, value: envVarEditor.value }}
            saving={envVarSaveInFlight}
            onKeyChange={(key) => setEnvVarEditor((current) => (current ? { ...current, key } : current))}
            onValueChange={(value) => setEnvVarEditor((current) => (current ? { ...current, value } : current))}
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
