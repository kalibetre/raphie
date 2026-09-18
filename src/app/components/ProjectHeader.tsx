import type { Project, ProjectRemovalMode } from '../../core/index.ts'
import { C } from '../theme.ts'
import { RemoveProjectButton } from './RemoveProjectButton.tsx'
import { RemoveProjectConfirmation } from './RemoveProjectConfirmation.tsx'

export function ProjectHeader({
  project,
  isRemoving,
  removalMode,
  removalError,
  removalInFlight,
  registrationInFlight,
  onStartRemove,
  onSelectRemovalMode,
  onCancelRemove,
  onConfirmRemove,
}: {
  project: Project
  isRemoving: boolean
  removalMode: ProjectRemovalMode
  removalError: string | null
  removalInFlight: boolean
  registrationInFlight: boolean
  onStartRemove: () => void
  onSelectRemovalMode: (mode: ProjectRemovalMode) => void
  onCancelRemove: () => void
  onConfirmRemove: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <text style={{ fontSize: 20, color: C.text }}>{project.name}</text>
        <text style={{ fontSize: 12, color: C.ghost }}>{project.folderPath}</text>
      </div>

      {isRemoving ? (
        <RemoveProjectConfirmation
          removalMode={removalMode}
          removalError={removalError}
          removalInFlight={removalInFlight}
          onSelectMode={onSelectRemovalMode}
          onCancel={onCancelRemove}
          onConfirm={onConfirmRemove}
        />
      ) : (
        <RemoveProjectButton disabled={registrationInFlight} onClick={onStartRemove} />
      )}
    </div>
  )
}
