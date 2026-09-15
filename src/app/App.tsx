import { motion, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EnvVar, Project, ProjectRemovalMode } from '../core/index.ts'
import { listEnvVars, listProjects, registerProject, removeProject, run } from '../core/index.ts'

import iconCopy from '../../assets/icons/copy.svg' with { type: 'text' }
import iconPanelLeft from '../../assets/icons/panel-left.svg' with { type: 'text' }
import iconTriangleAlert from '../../assets/icons/triangle-alert.svg' with { type: 'text' }
import iconX from '../../assets/icons/x.svg' with { type: 'text' }

// Icon source: Lucide (via `lucide-static`, vendored per-icon into assets/icons/),
// matching the icon set GPUIX's own example apps already standardize on.
// Add new icons the same way: copy the raw SVG from node_modules/lucide-static/icons/
// into assets/icons/, then add it to this map — one place to keep icon usage uniform.
const ICONS = {
  panelLeft: iconPanelLeft,
  copy: iconCopy,
  x: iconX,
  triangleAlert: iconTriangleAlert,
} as const

function Icon({ name, size = 14, color }: { name: keyof typeof ICONS; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}

const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  topBar: '#181818',
  border: '#292929',
  raised: '#232323',
  overlay: '#E6EAF20D',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  ghost: '#5C5C5C',
  accent: '#E2795B',
  onAccent: '#17181C',
  warning: '#D9A03D',
  warningBg: '#D9A03D1A',
}

const KEY_COLUMN_WIDTH = 240
const ACTIONS_COLUMN_WIDTH = 28

const DEFAULT_SIDEBAR_WIDTH = 260
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 440
const RESIZE_HANDLE_WIDTH = 4
// 48, not a round 40: trafficLightY=17 plus the ~14px dot height centers on a
// 48px-tall bar. This is also the exact height GPUIX's own chat.tsx example
// uses with the same trafficLightY, so it's a calibrated value, not a guess.
const TOP_BAR_HEIGHT = 48
// macOS draws the traffic lights over the app's top-left corner.
const TITLEBAR_CLEARANCE = typeof process !== 'undefined' && process.platform === 'darwin' ? 86 : 14

/**
 * Native macOS folder picker via Bun's own shell (`Bun.$`), not Node's
 * child_process. Referenced off the `Bun` global rather than `import { $ }
 * from 'bun'` so this file can still load under vitest, which has no `bun`
 * package in its module graph.
 */
export async function pickFolderNative(): Promise<string | null> {
  if (typeof Bun === 'undefined') return null
  try {
    const output = await Bun.$`osascript -e 'POSIX path of (choose folder)'`.text()
    return output.trim() || null
  } catch {
    return null // user cancelled
  }
}

/**
 * Copies a value to the system clipboard via `pbcopy`, the same native
 * shell-out pattern as `pickFolderNative`. `printf '%s'` (not `echo`) so no
 * trailing newline is added to a copied EnvVar value. Bun's shell escapes
 * interpolated `${}` values, so this is safe against shell injection.
 */
export async function copyToClipboard(value: string): Promise<void> {
  if (typeof Bun === 'undefined') return
  try {
    await Bun.$`printf '%s' ${value} | pbcopy`.quiet()
  } catch {
    // clipboard unavailable — nothing more to do
  }
}

const MASKED_VALUE = '••••••••'

export function initials(name: string): string {
  const words = name.split(/[\s-_]+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0]![0], words[1]![0]] : [name[0], name[1]]
  return letters.filter(Boolean).join('').toUpperCase()
}

function Badge({ label }: { label: string }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.accent,
      }}
    >
      <text style={{ fontSize: 9, fontWeight: 600, color: C.onAccent }}>{label}</text>
    </div>
  )
}

/**
 * A node listening for both onMouseDown and onMouseMove captures the
 * pointer, so onMouseMove/onMouseUp keep firing even once the drag leaves
 * this thin hitbox — no window-level listener needed (see GPUIX README's
 * "capture the pointer" section).
 */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      testId="sidebar-resize-handle"
      onMouseDown={(event) => {
        drag.current = { startX: event.x ?? 0, startWidth: width }
      }}
      onMouseMove={(event) => {
        if (!drag.current || event.x === undefined) return
        const next = drag.current.startWidth + (event.x - drag.current.startX)
        onResize(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)))
      }}
      onMouseUp={() => {
        drag.current = null
      }}
      style={{
        width: RESIZE_HANDLE_WIDTH,
        flexShrink: 0,
        height: '100%',
        cursor: 'col-resize',
        borderRightWidth: 1,
        borderColor: C.border,
        hover: { backgroundColor: C.accent, borderColor: C.accent },
      }}
    />
  )
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      testId="toast"
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 12,
        paddingRight: 8,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.raised,
      }}
    >
      <text style={{ fontSize: 12, color: C.text }}>{message}</text>
      <div
        testId="toast-dismiss"
        onClick={onDismiss}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          hover: { backgroundColor: C.overlay },
        }}
      >
        <Icon name="x" size={11} color={C.secondary} />
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: Project
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      testId={`project-${project.id}`}
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: 6,
        cursor: 'pointer',
        backgroundColor: selected ? C.overlay : undefined,
        hover: { backgroundColor: C.overlay },
      }}
    >
      <Badge label={initials(project.name)} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <text style={{ fontSize: 12, color: C.text }}>{project.name}</text>
        <text style={{ fontSize: 10, color: C.ghost }}>{project.folderPath}</text>
      </div>
    </div>
  )
}

function DuplicateBadge() {
  return (
    <div
      style={{
        flexShrink: 0,
        height: 16,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: C.warning,
        backgroundColor: C.warningBg,
      }}
    >
      <text style={{ fontSize: 9, color: C.warning }}>Duplicate</text>
    </div>
  )
}

function EnvVarRow({
  envVar,
  revealed,
  isDuplicate,
  isLast,
  onToggleReveal,
  onCopy,
}: {
  envVar: EnvVar
  revealed: boolean
  isDuplicate: boolean
  isLast: boolean
  onToggleReveal: () => void
  onCopy: () => void
}) {
  return (
    <div
      testId={`envvar-row-${envVar.key}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderColor: C.border,
        hover: { backgroundColor: C.overlay },
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          width: KEY_COLUMN_WIDTH,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            {/* No word-break primitive here, and env var names have no
                spaces to wrap on anyway — truncate long ones and let the
                tooltip carry the full name instead. */}
            <text
              style={{
                fontSize: 13,
                color: C.text,
                flexGrow: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {envVar.key}
            </text>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.raised,
            }}
          >
            <text style={{ fontSize: 11, color: C.text }}>{envVar.key}</text>
          </TooltipContent>
        </Tooltip>
        {isDuplicate ? <DuplicateBadge /> : null}
      </div>
      <div
        testId={`envvar-value-${envVar.key}`}
        onClick={onToggleReveal}
        style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', cursor: 'pointer' }}
      >
        {/* A revealed secret can be far longer than 8 mask dots (a path, a
            key) — truncate instead of forcing the row wider and pushing
            Copy out of view. */}
        <text
          style={{
            fontSize: 13,
            color: revealed ? C.text : C.ghost,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {revealed ? envVar.value : MASKED_VALUE}
        </text>
      </div>
      <div
        testId={`envvar-copy-${envVar.key}`}
        onClick={onCopy}
        aria-label={`Copy ${envVar.key} value`}
        style={{
          flexShrink: 0,
          width: ACTIONS_COLUMN_WIDTH,
          height: 24,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          hover: { backgroundColor: C.overlay },
        }}
      >
        <Icon name="copy" size={13} color={C.secondary} />
      </div>
    </div>
  )
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
      <div
        testId="top-bar"
        style={{
          height: TOP_BAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingLeft: TITLEBAR_CLEARANCE,
          paddingRight: 12,
          backgroundColor: C.topBar,
          borderBottomWidth: 1,
          borderColor: C.border,
        }}
      >
        <div
          testId="sidebar-toggle"
          onClick={() => setCollapsed((current) => !current)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            hover: { backgroundColor: C.overlay },
          }}
        >
          <Icon name="panelLeft" color={C.secondary} />
        </div>
        <text style={{ fontSize: 12, color: C.secondary }}>Raphie</text>
        <text style={{ fontSize: 12, color: C.ghost }}>/</text>
        <text style={{ fontSize: 13, color: selectedProject ? C.secondary : C.text }}>Projects</text>
        {selectedProject ? (
          <>
            <text style={{ fontSize: 12, color: C.ghost }}>/</text>
            <text testId="title-bar-project-name" style={{ fontSize: 13, color: C.text }}>
              {selectedProject.name}
            </text>
          </>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <div
          testId="add-project-button"
          onClick={handleBrowse}
          style={{
            paddingLeft: 10,
            paddingRight: 10,
            height: 26,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.border,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            hover: { backgroundColor: C.overlay },
          }}
        >
          <text style={{ fontSize: 12, color: C.secondary }}>+ Add Project</text>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        {/* Animate an outer clipping container and keep the sidebar itself at
            a fixed width, so collapsing doesn't reflow its text mid-transition
            (see GPUIX README's "Animate a sidebar" section). */}
        <motion.div
          initial={false}
          animate={{ width: collapsed ? 0 : sidebarWidth + RESIZE_HANDLE_WIDTH }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{ display: 'flex', flexDirection: 'row', height: '100%', flexShrink: 0, overflow: 'hidden' }}
        >
          <div
            testId="sidebar"
            onFileDrop={handleFileDrop}
            style={{
              width: sidebarWidth,
              flexShrink: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 10,
              paddingBottom: 10,
              backgroundColor: C.sidebar,
            }}
          >
            <input
              testId="project-search"
              value={query}
              placeholder="Search"
              onChange={(event) => setQuery(event.value ?? '')}
              style={{
                height: 26,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 6,
                backgroundColor: C.raised,
                fontSize: 12,
                color: C.text,
              }}
            />

            {visible.length === 0 ? (
              <text testId="drop-hint" style={{ fontSize: 11, color: C.secondary, paddingLeft: 8, paddingTop: 4 }}>
                {projects.length === 0 ? 'Drag a project folder here, or Add Project' : 'No matches'}
              </text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {visible.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selected={project.id === selectedId}
                    onSelect={() => {
                      setSelectedId(project.id)
                      setRemoveCandidateId(null)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <ResizeHandle width={sidebarWidth} onResize={setSidebarWidth} />
        </motion.div>

        <div
          testId="main-pane"
          onFileDrop={handleFileDrop}
          style={{
            flexGrow: 1,
            // A flex item's implicit min-width is its content's min-content
            // size, so a long revealed EnvVar value (which paints truncated,
            // but is still "wide" for sizing purposes) would otherwise stop
            // this pane from shrinking to the window and push everything in
            // it — including the Remove Project button — off-screen.
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'scroll',
          }}
        >
          {registrationInFlight ? (
            <text testId="registration-status" style={{ fontSize: 12, color: C.secondary, padding: 24 }}>
              Registering project…
            </text>
          ) : null}
          {selectedProject ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                width: '100%',
                maxWidth: 1040,
                alignSelf: 'center',
                paddingLeft: 32,
                paddingRight: 32,
                paddingTop: 28,
                paddingBottom: 28,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <text style={{ fontSize: 20, color: C.text }}>{selectedProject.name}</text>
                  <text style={{ fontSize: 12, color: C.ghost }}>{selectedProject.folderPath}</text>
                </div>

                {removeCandidateId === selectedProject.id ? (
                  <div
                    testId="remove-project-confirmation"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      padding: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.sidebar,
                      flexShrink: 0,
                    }}
                  >
                    <text style={{ fontSize: 11, color: C.secondary }}>Remove this Project from Raphie?</text>
                    <text style={{ fontSize: 10, color: C.ghost }}>Choose what to do with the project’s .env:</text>
                    <div
                      testId="remove-env-copy-option"
                      onClick={() => {
                        if (!removalInFlight) setRemovalMode('copy')
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        width: 300,
                        padding: 8,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: removalMode === 'copy' ? C.accent : C.border,
                        backgroundColor: removalMode === 'copy' ? C.overlay : undefined,
                        cursor: 'pointer',
                      }}
                    >
                      <text style={{ fontSize: 11, color: C.text }}>Copy .env into the project folder</text>
                      <text style={{ fontSize: 10, color: C.ghost }}>Recommended: keep the project’s current env values.</text>
                    </div>
                    <div
                      testId="remove-env-delete-option"
                      onClick={() => {
                        if (!removalInFlight) setRemovalMode('remove')
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        width: 300,
                        padding: 8,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: removalMode === 'remove' ? C.accent : C.border,
                        backgroundColor: removalMode === 'remove' ? C.overlay : undefined,
                        cursor: 'pointer',
                      }}
                    >
                      <text style={{ fontSize: 11, color: C.text }}>Remove .env entirely</text>
                      <text style={{ fontSize: 10, color: C.ghost }}>Delete the project’s .env and Raphie’s Central copy.</text>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                      <div
                        testId="cancel-remove-project"
                        onClick={() => {
                          if (!removalInFlight) setRemoveCandidateId(null)
                        }}
                        style={{
                          height: 26,
                          paddingLeft: 10,
                          paddingRight: 10,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                          hover: { backgroundColor: C.overlay },
                        }}
                      >
                        <text style={{ fontSize: 12, color: C.secondary }}>Cancel</text>
                      </div>
                      <div
                        testId="confirm-remove-project"
                        onClick={handleRemoveProject}
                        style={{
                          height: 26,
                          paddingLeft: 10,
                          paddingRight: 10,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                          backgroundColor: C.accent,
                          opacity: removalInFlight ? 0.6 : 1,
                        }}
                      >
                        <text style={{ fontSize: 12, color: C.onAccent }}>
                          {removalInFlight ? 'Removing…' : 'Remove'}
                        </text>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    testId="remove-project-button"
                    onClick={() => {
                      if (!registrationInFlight) {
                        setRemovalMode('copy')
                        setRemoveCandidateId(selectedProject.id)
                      }
                    }}
                    style={{
                      height: 26,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      borderWidth: 1,
                      borderColor: C.border,
                      opacity: registrationInFlight ? 0.6 : 1,
                      flexShrink: 0,
                      hover: { backgroundColor: C.overlay },
                    }}
                  >
                    <text style={{ fontSize: 12, color: C.secondary }}>Remove Project</text>
                  </div>
                )}
              </div>

              {/* Single tab for now — a placeholder for Worktrees and other
                  per-Project screens to join later as siblings. */}
              <div style={{ display: 'flex', flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
                <div testId="tab-env-vars" style={{ paddingBottom: 10, borderBottomWidth: 2, borderColor: C.accent }}>
                  <text style={{ fontSize: 13, color: C.text }}>Env Vars</text>
                </div>
              </div>

              {duplicateKeys.size > 0 ? (
                <div
                  testId="duplicate-keys-warning"
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: C.warning,
                    backgroundColor: C.warningBg,
                  }}
                >
                  <Icon name="triangleAlert" size={14} color={C.warning} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <text style={{ fontSize: 12, color: C.text }}>
                      Duplicate EnvVars found. Remove or rename them below.
                    </text>
                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {[...duplicateKeys].map((key) => (
                        <div
                          key={key}
                          style={{
                            height: 18,
                            paddingLeft: 6,
                            paddingRight: 6,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            borderWidth: 1,
                            borderColor: C.warning,
                            backgroundColor: C.canvas,
                          }}
                        >
                          <text style={{ fontSize: 10, color: C.warning }}>{key}</text>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {envVars.length === 0 ? (
                <text testId="envvar-empty-hint" style={{ fontSize: 12, color: C.ghost }}>
                  No EnvVars in this Project's Central env file
                </text>
              ) : (
                <div
                  testId="envvar-table"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingLeft: 16,
                      paddingRight: 16,
                      paddingTop: 8,
                      paddingBottom: 8,
                      backgroundColor: C.sidebar,
                      borderBottomWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <text style={{ fontSize: 11, color: C.secondary, width: KEY_COLUMN_WIDTH, flexShrink: 0 }}>Key</text>
                    <text style={{ fontSize: 11, color: C.secondary, flexGrow: 1 }}>Value</text>
                    <div style={{ width: ACTIONS_COLUMN_WIDTH, flexShrink: 0 }} />
                  </div>
                  {envVars.map((envVar, index) => (
                    <EnvVarRow
                      key={`${envVar.key}-${index}`}
                      envVar={envVar}
                      revealed={revealedKeys.has(envVar.key)}
                      isDuplicate={duplicateKeys.has(envVar.key)}
                      isLast={index === envVars.length - 1}
                      onToggleReveal={() =>
                        setRevealedKeys((current) => {
                          const next = new Set(current)
                          if (next.has(envVar.key)) next.delete(envVar.key)
                          else next.add(envVar.key)
                          return next
                        })
                      }
                      onCopy={() => handleCopyEnvVar(envVar)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <text style={{ fontSize: 13, color: C.ghost }}>Select a project</text>
            </div>
          )}
        </div>
      </div>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </div>
    </TooltipProvider>
  )
}
