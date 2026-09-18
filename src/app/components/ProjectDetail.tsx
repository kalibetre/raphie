import type { EnvVar, Project, ProjectRemovalMode, Worktree } from '../../core/index.ts'
import { useState } from 'react'
import { C } from '../theme.ts'
import type { WorktreeOpenTarget } from '../utils/openWorktree.ts'
import { DuplicateKeysWarning } from './DuplicateKeysWarning.tsx'
import { EnvVarTable } from './EnvVarTable.tsx'
import { ProjectHeader } from './ProjectHeader.tsx'
import { WorktreeList } from './WorktreeList.tsx'

type ProjectTab = 'env-vars' | 'worktrees'

export function ProjectDetail({
  project,
  envVars,
  worktrees,
  worktreesLoading,
  worktreesRefreshing,
  revealedKeys,
  duplicateKeys,
  searchQuery,
  onSearchQueryChange,
  isRemoving,
  removalMode,
  removalError,
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
  onOpenWorktree,
  lastOpenWorktreeTarget,
  onSelectOpenWorktreeTarget,
  onDeleteWorktree,
  onLinkWorktree,
  onUnlinkWorktree,
  onRefreshWorktrees,
}: {
  project: Project
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
  onOpenWorktree: (path: string, target: WorktreeOpenTarget) => void
  lastOpenWorktreeTarget: WorktreeOpenTarget | null
  onSelectOpenWorktreeTarget: (target: WorktreeOpenTarget) => void
  onDeleteWorktree: (path: string) => void
  onLinkWorktree: (path: string) => void
  onUnlinkWorktree: (path: string) => void
  onRefreshWorktrees: () => void
}) {
  const [activeTab, setActiveTab] = useState<ProjectTab>('env-vars')
  const showingWorktrees = activeTab === 'worktrees'

  return (
    <div
      testId="project-detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        gap: 16,
        width: '100%',
        maxWidth: 1040,
        alignSelf: 'center',
        paddingLeft: 32,
        paddingRight: 32,
        paddingTop: 28,
        paddingBottom: 28,
        overflowY: 'hidden',
      }}
    >
      <ProjectHeader
        project={project}
        isRemoving={isRemoving}
        removalMode={removalMode}
        removalError={removalError}
        removalInFlight={removalInFlight}
        registrationInFlight={registrationInFlight}
        onStartRemove={onStartRemove}
        onSelectRemovalMode={onSelectRemovalMode}
        onCancelRemove={onCancelRemove}
        onConfirmRemove={onConfirmRemove}
      />

      <div style={{ display: 'flex', flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
        <div
          testId="tab-env-vars"
          role="button"
          onClick={() => setActiveTab('env-vars')}
          style={{
            paddingBottom: 10,
            paddingRight: 16,
            borderBottomWidth: showingWorktrees ? 0 : 2,
            borderColor: C.accent,
            cursor: 'pointer',
          }}
        >
          <text style={{ fontSize: 13, color: C.text }}>Env Vars</text>
        </div>
        <div
          testId="tab-worktrees"
          role="button"
          onClick={() => setActiveTab('worktrees')}
          style={{
            paddingBottom: 10,
            paddingLeft: 16,
            paddingRight: 16,
            borderBottomWidth: showingWorktrees ? 2 : 0,
            borderColor: C.accent,
            cursor: 'pointer',
          }}
        >
          <text style={{ fontSize: 13, color: C.text }}>Worktrees</text>
        </div>
      </div>

      <div
        testId="project-detail-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
          minHeight: 0,
          width: '100%',
          alignSelf: 'stretch',
          gap: 16,
          overflowY: showingWorktrees ? 'hidden' : 'scroll',
        }}
      >
        {showingWorktrees ? (
          <WorktreeList
            worktrees={worktrees}
            loading={worktreesLoading}
            refreshing={worktreesRefreshing}
            projectFolderPath={project.folderPath}
            lastOpenWorktreeTarget={lastOpenWorktreeTarget}
            onOpenWorktree={onOpenWorktree}
            onSelectOpenWorktreeTarget={onSelectOpenWorktreeTarget}
            onDeleteWorktree={onDeleteWorktree}
            onLinkWorktree={onLinkWorktree}
            onUnlinkWorktree={onUnlinkWorktree}
            onRefresh={onRefreshWorktrees}
          />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
