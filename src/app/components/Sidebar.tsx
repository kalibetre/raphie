import { motion } from '@gpuix/react'
import type { Project } from '../../core/index.ts'
import { C, RESIZE_HANDLE_WIDTH } from '../theme.ts'
import { ProjectRow } from './ProjectRow.tsx'
import { ResizeHandle } from './ResizeHandle.tsx'

export function Sidebar({
  visibleProjects,
  hasAnyProjects,
  query,
  onQueryChange,
  selectedId,
  onSelectProject,
  width,
  onResizeWidth,
  collapsed,
  onFileDrop,
}: {
  visibleProjects: Project[]
  hasAnyProjects: boolean
  query: string
  onQueryChange: (query: string) => void
  selectedId: string | null
  onSelectProject: (id: string) => void
  width: number
  onResizeWidth: (width: number) => void
  collapsed: boolean
  onFileDrop: (event: { paths?: string[] }) => void
}) {
  return (
    // Animate an outer clipping container and keep the sidebar itself at
    // a fixed width, so collapsing doesn't reflow its text mid-transition
    // (see GPUIX README's "Animate a sidebar" section).
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 0 : width + RESIZE_HANDLE_WIDTH }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ display: 'flex', flexDirection: 'row', height: '100%', flexShrink: 0, overflow: 'hidden' }}
    >
      <div
        testId="sidebar"
        onFileDrop={onFileDrop}
        style={{
          width,
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
          onChange={(event) => onQueryChange(event.value ?? '')}
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

        {visibleProjects.length === 0 ? (
          <text testId="drop-hint" style={{ fontSize: 11, color: C.secondary, paddingLeft: 8, paddingTop: 4 }}>
            {hasAnyProjects ? 'No matches' : 'Drag a project folder here, or Add Project'}
          </text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visibleProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedId}
                onSelect={() => onSelectProject(project.id)}
              />
            ))}
          </div>
        )}
      </div>
      <ResizeHandle width={width} onResize={onResizeWidth} />
    </motion.div>
  )
}
