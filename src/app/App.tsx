import { TooltipProvider } from '@gpuix/react'
import { useEffect, useMemo, useState } from 'react'
import type { EnvVar, Project, ProjectRemovalMode } from '../core/index.ts'
import { listEnvVars, listProjects, registerProject, removeProject, run } from '../core/index.ts'
import { MainPane } from './components/MainPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { C, DEFAULT_SIDEBAR_WIDTH } from './theme.ts'
import { copyToClipboard } from './utils/clipboard.ts'
import { pickFolderNative } from './utils/pickFolder.ts'

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
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
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
            isRemoving={removeCandidateId === selectedProject?.id}
            removalMode={removalMode}
            removalInFlight={removalInFlight}
            onFileDrop={handleFileDrop}
            onToggleReveal={handleToggleReveal}
            onCopy={handleCopyEnvVar}
            onStartRemove={handleStartRemove}
            onSelectRemovalMode={setRemovalMode}
            onCancelRemove={handleCancelRemove}
            onConfirmRemove={handleRemoveProject}
          />
        </div>

        {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
      </div>
    </TooltipProvider>
  )
}
