import type { Project } from '../../core/index.ts'
import { Icon } from '../icons.tsx'
import { C, TITLEBAR_CLEARANCE, TOP_BAR_HEIGHT } from '../theme.ts'

export function TopBar({
  selectedProject,
  onToggleSidebar,
  onAddProject,
}: {
  selectedProject: Project | null
  onToggleSidebar: () => void
  onAddProject: () => void
}) {
  return (
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
        onClick={onToggleSidebar}
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
        onClick={onAddProject}
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
  )
}
