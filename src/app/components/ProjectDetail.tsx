import type { EnvVar, Project, ProjectRemovalMode } from '../../core/index.ts'
import { C } from '../theme.ts'
import { DuplicateKeysWarning } from './DuplicateKeysWarning.tsx'
import { EnvVarTable } from './EnvVarTable.tsx'
import { ProjectHeader } from './ProjectHeader.tsx'

export function ProjectDetail({
  project,
  envVars,
  revealedKeys,
  duplicateKeys,
  isRemoving,
  removalMode,
  removalInFlight,
  registrationInFlight,
  onToggleReveal,
  onCopy,
  onStartAdd,
  onEdit,
  onDelete,
  onStartRemove,
  onSelectRemovalMode,
  onCancelRemove,
  onConfirmRemove,
}: {
  project: Project
  envVars: EnvVar[]
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  isRemoving: boolean
  removalMode: ProjectRemovalMode
  removalInFlight: boolean
  registrationInFlight: boolean
  onToggleReveal: (key: string) => void
  onCopy: (envVar: EnvVar) => void
  onStartAdd: () => void
  onEdit: (index: number) => void
  onDelete: (index: number) => void
  onStartRemove: () => void
  onSelectRemovalMode: (mode: ProjectRemovalMode) => void
  onCancelRemove: () => void
  onConfirmRemove: () => void
}) {
  return (
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
      <ProjectHeader
        project={project}
        isRemoving={isRemoving}
        removalMode={removalMode}
        removalInFlight={removalInFlight}
        registrationInFlight={registrationInFlight}
        onStartRemove={onStartRemove}
        onSelectRemovalMode={onSelectRemovalMode}
        onCancelRemove={onCancelRemove}
        onConfirmRemove={onConfirmRemove}
      />

      {/* Single tab for now — a placeholder for Worktrees and other
          per-Project screens to join later as siblings. */}
      <div style={{ display: 'flex', flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
        <div testId="tab-env-vars" style={{ paddingBottom: 10, borderBottomWidth: 2, borderColor: C.accent }}>
          <text style={{ fontSize: 13, color: C.text }}>Env Vars</text>
        </div>
      </div>

      <DuplicateKeysWarning duplicateKeys={duplicateKeys} />

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <text style={{ fontSize: 13, color: C.secondary }}>Environment variables</text>
        <div
          testId="add-envvar-button"
          role="button"
          aria-label="Add EnvVar"
          onClick={onStartAdd}
          style={{
            height: 28,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderWidth: 1,
            borderColor: C.border,
            hover: { backgroundColor: C.overlay },
          }}
        >
          <text style={{ fontSize: 12, color: C.secondary }}>Add EnvVar</text>
        </div>
      </div>

      <EnvVarTable
        envVars={envVars}
        revealedKeys={revealedKeys}
        duplicateKeys={duplicateKeys}
        onToggleReveal={onToggleReveal}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  )
}
