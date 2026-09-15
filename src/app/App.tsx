import { motion } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../core/index.ts'
import { listProjects, registerProject, run } from '../core/index.ts'

import iconPanelLeft from '../../assets/icons/panel-left.svg' with { type: 'text' }

// Icon source: Lucide (via `lucide-static`, vendored per-icon into assets/icons/),
// matching the icon set GPUIX's own example apps already standardize on.
// Add new icons the same way: copy the raw SVG from node_modules/lucide-static/icons/
// into assets/icons/, then add it to this map — one place to keep icon usage uniform.
const ICONS = {
  panelLeft: iconPanelLeft,
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
}

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

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    run(listProjects).then(setProjects)
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (project) => project.name.toLowerCase().includes(q) || project.folderPath.toLowerCase().includes(q),
    )
  }, [projects, query])

  const selectedProject = projects.find((project) => project.id === selectedId) ?? null

  const registerFolders = (folderPaths: string[]) => {
    if (folderPaths.length === 0) return
    Promise.all(folderPaths.map((folderPath) => run(registerProject({ folderPath })))).then((registered) =>
      setProjects((current) => [...current, ...registered]),
    )
  }

  const handleFileDrop = (event: { paths?: string[] }) => registerFolders(event.paths ?? [])

  const handleBrowse = () => {
    pickFolderNative().then((folderPath) => {
      if (folderPath) registerFolders([folderPath])
    })
  }

  return (
    <div
      testId="app-root"
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.canvas }}
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
                    onSelect={() => setSelectedId(project.id)}
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
          style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {selectedProject ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <text style={{ fontSize: 16, color: C.text }}>{selectedProject.name}</text>
              <text style={{ fontSize: 12, color: C.ghost }}>{selectedProject.folderPath}</text>
            </div>
          ) : (
            <text style={{ fontSize: 13, color: C.ghost }}>Select a project</text>
          )}
        </div>
      </div>
    </div>
  )
}
