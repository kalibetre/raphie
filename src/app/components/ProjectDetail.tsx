import type { EnvVar, Project, ProjectRemovalMode, Worktree } from '../../core/index.ts'
import { C } from '../theme.ts'
import { DuplicateKeysWarning } from './DuplicateKeysWarning.tsx'
import { EnvVarTable } from './EnvVarTable.tsx'
import { ProjectHeader } from './ProjectHeader.tsx'
import { WorktreeList } from './WorktreeList.tsx'

export function ProjectDetail({
  project,
  envVars,
  worktrees,
  revealedKeys,
  duplicateKeys,
  searchQuery,
  onSearchQueryChange,
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
  worktrees: Worktree[]
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  searchQuery: string
  isRemoving: boolean
  removalMode: ProjectRemovalMode
  removalInFlight: boolean
  registrationInFlight: boolean
  onToggleReveal: (key: string) => void
  onCopy: (envVar: EnvVar) => void
  onSearchQueryChange: (query: string) => void
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

      <WorktreeList worktrees={worktrees} />

      <DuplicateKeysWarning duplicateKeys={duplicateKeys} />

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <text style={{ fontSize: 13, color: C.secondary }}>Environment variables</text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            testId="envvar-search"
            value={searchQuery}
            placeholder="Search EnvVars"
            onChange={(event) => onSearchQueryChange(event.value ?? '')}
            style={{
              width: 220,
              height: 28,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.raised,
              fontSize: 12,
              color: C.text,
            }}
          />
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
      </div>

      <EnvVarTable
        envVars={envVars}
        revealedKeys={revealedKeys}
        duplicateKeys={duplicateKeys}
        searchQuery={searchQuery}
        onToggleReveal={onToggleReveal}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  )
}
