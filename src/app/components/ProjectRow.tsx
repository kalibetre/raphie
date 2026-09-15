import type { Project } from '../../core/index.ts'
import { C } from '../theme.ts'
import { initials } from '../utils/initials.ts'
import { Badge } from './Badge.tsx'

export function ProjectRow({
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
