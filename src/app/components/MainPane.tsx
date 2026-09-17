import type { EnvVar, Project, ProjectRemovalMode } from '../../core/index.ts'
import { C } from '../theme.ts'
import { ProjectDetail } from './ProjectDetail.tsx'

export function MainPane({
  selectedProject,
  registrationInFlight,
  envVars,
  revealedKeys,
  duplicateKeys,
  searchQuery,
  isRemoving,
  removalMode,
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
}: {
  selectedProject: Project | null
  registrationInFlight: boolean
  envVars: EnvVar[]
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  searchQuery: string
  isRemoving: boolean
  removalMode: ProjectRemovalMode
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
        <ProjectDetail
          project={selectedProject}
          envVars={envVars}
          revealedKeys={revealedKeys}
          duplicateKeys={duplicateKeys}
          searchQuery={searchQuery}
          isRemoving={isRemoving}
          removalMode={removalMode}
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
        />
      ) : (
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <text style={{ fontSize: 13, color: C.ghost }}>Select a project</text>
        </div>
      )}
    </div>
  )
}
