import type { EnvVar, Project, ProjectRemovalMode, Worktree } from '../../core/index.ts'
import { C } from '../theme.ts'
import type { WorktreeOpenTarget } from '../utils/openWorktree.ts'
import { ProjectDetail } from './ProjectDetail.tsx'

export function MainPane({
  selectedProject,
  registrationInFlight,
  envVars,
  worktrees,
  worktreesLoading,
  worktreesRefreshing,
  revealedKeys,
  duplicateKeys,
  searchQuery,
  isRemoving,
  removalMode,
  removalError,
  removalInFlight,
  onFileDrop,
  onToggleReveal,
  onCopy,
  onSearchQueryChange,
  onStartAdd,
  onEdit,
  onDelete,
  onStartRemove,
  onSelectRemovalMode,
  onCancelRemove,
  onConfirmRemove,
  onOpenWorktree,
  lastOpenWorktreeTarget,
  onSelectOpenWorktreeTarget,
  onDeleteWorktree,
  onRefreshWorktrees,
}: {
  selectedProject: Project | null
  registrationInFlight: boolean
  envVars: EnvVar[]
  worktrees: Worktree[]
  worktreesLoading: boolean
  worktreesRefreshing: boolean
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  searchQuery: string
  isRemoving: boolean
  removalMode: ProjectRemovalMode
  removalError: string | null
  removalInFlight: boolean
  onFileDrop: (event: { paths?: string[] }) => void
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
  onOpenWorktree: (path: string, target: WorktreeOpenTarget) => void
  lastOpenWorktreeTarget: WorktreeOpenTarget | null
  onSelectOpenWorktreeTarget: (target: WorktreeOpenTarget) => void
  onDeleteWorktree: (path: string) => void
  onRefreshWorktrees: () => void
}) {
  return (
    <div
      testId="main-pane"
      onFileDrop={onFileDrop}
      style={{
        flexGrow: 1,
        // A flex item's implicit min-width is its content's min-content
        // size, so a long revealed EnvVar value (which paints truncated,
        // but is still "wide" for sizing purposes) would otherwise stop
        // this pane from shrinking to the window and push everything in
        // it — including the Remove Project button — off-screen.
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'hidden',
      }}
    >
      {registrationInFlight ? (
        <text testId="registration-status" style={{ fontSize: 12, color: C.secondary, padding: 24 }}>
          Registering project…
        </text>
      ) : null}
      {selectedProject ? (
        <ProjectDetail
          key={selectedProject.id}
          project={selectedProject}
          envVars={envVars}
          worktrees={worktrees}
          worktreesLoading={worktreesLoading}
          worktreesRefreshing={worktreesRefreshing}
          revealedKeys={revealedKeys}
          duplicateKeys={duplicateKeys}
          searchQuery={searchQuery}
          isRemoving={isRemoving}
          removalMode={removalMode}
          removalError={removalError}
          removalInFlight={removalInFlight}
          registrationInFlight={registrationInFlight}
          onToggleReveal={onToggleReveal}
          onCopy={onCopy}
          onSearchQueryChange={onSearchQueryChange}
          onStartAdd={onStartAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          onStartRemove={onStartRemove}
          onSelectRemovalMode={onSelectRemovalMode}
          onCancelRemove={onCancelRemove}
          onConfirmRemove={onConfirmRemove}
          onOpenWorktree={onOpenWorktree}
          lastOpenWorktreeTarget={lastOpenWorktreeTarget}
          onSelectOpenWorktreeTarget={onSelectOpenWorktreeTarget}
          onDeleteWorktree={onDeleteWorktree}
          onRefreshWorktrees={onRefreshWorktrees}
        />
      ) : (
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <text style={{ fontSize: 13, color: C.ghost }}>Select a project</text>
        </div>
      )}
    </div>
  )
}
