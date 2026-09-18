import type { Worktree } from '../../core/index.ts'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons.tsx'
import type { IconName } from '../icons.tsx'
import { C, type ThemeColor } from '../theme.ts'
import { isMainWorktreePath } from '../worktreePath.ts'
import { DEFAULT_WORKTREE_SORT, sortWorktrees, type WorktreeSort } from '../worktreeSort.ts'
import {
  discoverAvailableOpenWorktreeOptions,
  type WorktreeOpenOption,
  type WorktreeOpenTarget,
} from '../utils/openWorktree.ts'
import {
  ESTIMATED_WORKTREE_ITEM_HEIGHT,
  INITIAL_WORKTREE_WINDOW_SIZE,
  selectWorktreeWindow,
  selectWorktreeWindowAroundVisibleRange,
  type WorktreeWindow,
} from '../worktreeWindow.ts'
import { IconButton } from './IconButton.tsx'
import { EnvFileBadge } from './EnvFileBadge.tsx'
import { WorktreeOpenMenu } from './WorktreeOpenMenu.tsx'
import { WorktreeSortButtons } from './WorktreeSortButtons.tsx'

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 'B'
  for (const nextUnit of units) {
    value /= 1024
    unit = nextUnit
    if (value < 1024 || nextUnit === units[units.length - 1]) break
  }

  const precision = value < 10 && unit !== 'KB' ? 1 : 0
  return `${value.toFixed(precision)} ${unit}`
}

const commitDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const formatCommitDate = (date: string) => {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date

  return commitDateFormatter.format(parsed)
}

function WorktreeMetaItem({
  icon,
  label,
  value,
  testId,
  color = C.text,
  iconColor = C.secondary,
  grow = false,
}: {
  icon: IconName
  label: string
  value: string
  testId?: string
  color?: ThemeColor
  iconColor?: ThemeColor
  grow?: boolean
}) {
  return (
    <div
      aria-label={`${label}: ${value}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        flexGrow: grow ? 1 : 0,
        flexShrink: grow ? 1 : 0,
      }}
    >
      <Icon name={icon} size={12} color={iconColor} />
      <text testId={testId} style={{ fontSize: 11, color, minWidth: 0 }}>
        {value}
      </text>
    </div>
  )
}

const Skeleton = ({ width }: { width: number }) => (
  <div style={{ width, height: 11, borderRadius: 4, backgroundColor: C.raised }} />
)

function WorktreeMetadataSkeleton({ index }: { index: number }) {
  return (
    <div
      testId={`worktree-metadata-skeleton-${index}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 2,
        paddingBottom: 2,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        <Skeleton width={180} />
        <Skeleton width={280} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        <Skeleton width={140} />
        <Skeleton width={70} />
        <Skeleton width={90} />
      </div>
    </div>
  )
}

function WorktreeRow({
  worktree,
  index,
  projectFolderPath,
  openWorktreeOptions,
  lastOpenWorktreeTarget,
  onOpenWorktree,
  onSelectOpenWorktreeTarget,
  onLinkWorktree,
  onDeleteWorktree,
}: {
  worktree: Worktree
  index: number
  projectFolderPath: string
  openWorktreeOptions: readonly WorktreeOpenOption[]
  lastOpenWorktreeTarget: WorktreeOpenTarget | null
  onOpenWorktree: (path: string, target: WorktreeOpenTarget) => void | Promise<void>
  onSelectOpenWorktreeTarget: (target: WorktreeOpenTarget) => void
  onLinkWorktree: (path: string) => void
  onDeleteWorktree: (path: string) => void
}) {
  const metadata = worktree.metadata
  const commit = metadata?.lastCommit
  const isMainWorktree = isMainWorktreePath(worktree.path, projectFolderPath)
  const selectedOpenTarget =
    (lastOpenWorktreeTarget && openWorktreeOptions.some((option) => option.value === lastOpenWorktreeTarget)
      ? lastOpenWorktreeTarget
      : openWorktreeOptions[0]?.value) ?? null

  return (
    <div
      testId={`worktree-${index}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        alignSelf: 'stretch',
        flexShrink: 0,
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: isMainWorktree ? C.accent : C.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {isMainWorktree ? (
              <div
                testId={`worktree-main-badge-${index}`}
                aria-label="Main Worktree"
                style={{
                  width: 19,
                  height: 19,
                  borderRadius: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: C.accent,
                  flexShrink: 0,
                }}
              >
                <Icon name="house" size={12} color={C.onAccent} />
              </div>
            ) : null}
            <text testId={`worktree-path-${index}`} style={{ fontSize: 12, color: C.text, minWidth: 0 }}>
              {worktree.path}
            </text>
            {isMainWorktree ? <text style={{ fontSize: 10, color: C.accent, flexShrink: 0 }}>Main</text> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {metadata ? (
              <WorktreeMetaItem
                icon="hardDrive"
                label="Size"
                value={formatSize(metadata.size)}
                testId={`worktree-size-${index}`}
                color={C.secondary}
                iconColor={C.secondary}
              />
            ) : (
              <Skeleton width={42} />
            )}
            <div
              testId={`worktree-status-${index}`}
              aria-label={worktree.linked ? 'Linked' : 'Not Linked'}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}
            >
              <Icon name={worktree.linked ? 'link' : 'unlink'} size={12} color={worktree.linked ? C.accent : C.secondary} />
              <text style={{ fontSize: 11, color: worktree.linked ? C.accent : C.secondary }}>
                {worktree.linked ? 'Linked' : 'Not Linked'}
              </text>
            </div>
            {worktree.hasEnvFile && !worktree.linked ? <EnvFileBadge index={index} /> : null}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!worktree.linked ? (
            <IconButton
              testId={`link-worktree-${index}`}
              label="Link Worktree to Central env file"
              icon="link"
              color={C.accent}
              onClick={() => onLinkWorktree(worktree.path)}
            />
          ) : null}
          <WorktreeOpenMenu
            index={index}
            options={openWorktreeOptions}
            selectedTarget={selectedOpenTarget}
            onOpen={(target) => onOpenWorktree(worktree.path, target)}
            onSelect={onSelectOpenWorktreeTarget}
          />
          <IconButton
            testId={`delete-worktree-${index}`}
            label={isMainWorktree ? 'Cannot delete the main Worktree' : 'Delete Worktree'}
            icon="trash2"
            color={isMainWorktree ? C.ghost : C.secondary}
            disabled={isMainWorktree}
            onClick={() => onDeleteWorktree(worktree.path)}
          />
        </div>
      </div>

      {metadata ? (
        <div
          testId={`worktree-details-${index}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 2,
            paddingBottom: 2,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <WorktreeMetaItem
              icon="gitBranch"
              label="Branch"
              value={metadata.branch ?? 'Detached HEAD'}
              testId={`worktree-branch-${index}`}
            />
            <WorktreeMetaItem
              icon="gitCommit"
              label="Last commit"
              value={commit ? `${commit.hash} · ${commit.subject}` : 'No commits'}
              testId={`worktree-commit-${index}`}
              grow
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <WorktreeMetaItem
              icon="calendar"
              label="Last commit date"
              value={commit ? formatCommitDate(commit.date) : 'No commits'}
              testId={`worktree-commit-date-${index}`}
            />
            <WorktreeMetaItem
              icon="filePlus"
              label="Staged changes"
              value={`${metadata.stagedChanges}`}
              testId={`worktree-staged-${index}`}
              color={metadata.stagedChanges > 0 ? C.accent : C.secondary}
              iconColor={metadata.stagedChanges > 0 ? C.accent : C.secondary}
            />
            <WorktreeMetaItem
              icon="fileMinus"
              label="Unstaged changes"
              value={`${metadata.unstagedChanges}`}
              testId={`worktree-unstaged-${index}`}
              color={metadata.unstagedChanges > 0 ? C.accent : C.secondary}
              iconColor={metadata.unstagedChanges > 0 ? C.accent : C.secondary}
            />
          </div>
        </div>
      ) : (
        <WorktreeMetadataSkeleton index={index} />
      )}
    </div>
  )
}

export function WorktreeList({
  worktrees,
  loading,
  refreshing,
  onRefresh,
  projectFolderPath,
  lastOpenWorktreeTarget,
  onOpenWorktree,
  onDeleteWorktree,
  onLinkWorktree,
  onSelectOpenWorktreeTarget,
}: {
  worktrees: Worktree[]
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
  projectFolderPath: string
  lastOpenWorktreeTarget: WorktreeOpenTarget | null
  onOpenWorktree: (path: string, target: WorktreeOpenTarget) => void | Promise<void>
  onLinkWorktree: (path: string) => void
  onDeleteWorktree: (path: string) => void
  onSelectOpenWorktreeTarget: (target: WorktreeOpenTarget) => void
}) {
  const [openWorktreeOptions, setOpenWorktreeOptions] = useState<readonly WorktreeOpenOption[]>([])
  const [sort, setSort] = useState<WorktreeSort>(DEFAULT_WORKTREE_SORT)
  const sortedWorktrees = useMemo(() => sortWorktrees(worktrees, sort), [sort, worktrees])
  const [window, setWindow] = useState<WorktreeWindow>(() =>
    selectWorktreeWindow(worktrees.length, 0, INITIAL_WORKTREE_WINDOW_SIZE),
  )
  const renderedWindow = selectWorktreeWindow(sortedWorktrees.length, window.start, window.end)

  useEffect(() => {
    setWindow((current) => selectWorktreeWindow(worktrees.length, current.start, current.end))
  }, [worktrees.length])

  useEffect(() => {
    let active = true
    discoverAvailableOpenWorktreeOptions().then((options) => {
      if (active) setOpenWorktreeOptions(options)
    })
    return () => {
      active = false
    }
  }, [])

  const handleVisibleRange = (event: { startIndex?: number; endIndex?: number }) => {
    if (event.startIndex === undefined || event.endIndex === undefined) return
    const startIndex = event.startIndex
    const endIndex = event.endIndex
    setWindow((current) => {
      const next = selectWorktreeWindowAroundVisibleRange(sortedWorktrees.length, startIndex, endIndex)
      return current.start === next.start && current.end === next.end ? current : next
    })
  }

  const handleSortChange = (nextSort: WorktreeSort) => {
    setSort(nextSort)
    setWindow(selectWorktreeWindow(sortedWorktrees.length, 0, INITIAL_WORKTREE_WINDOW_SIZE))
  }

  return (
    <div
      testId="worktrees-section"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1, minHeight: 0, width: '100%', alignSelf: 'stretch' }}
    >
      {loading ? (
        <text testId="worktrees-loading" style={{ fontSize: 12, color: C.ghost }}>
          Loading Worktrees…
        </text>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <WorktreeSortButtons sort={sort} onChange={handleSortChange} />
            <IconButton
              testId="worktrees-refresh"
              label={refreshing ? 'Refreshing Worktrees' : 'Refresh Worktrees'}
              icon="refreshCw"
              color={C.secondary}
              disabled={refreshing}
              onClick={onRefresh}
            />
          </div>
          {worktrees.length === 0 ? (
            <text testId="worktrees-empty" style={{ fontSize: 12, color: C.ghost }}>
              No Git Worktrees found.
            </text>
          ) : (
            <virtual-list
              key={`worktrees-${sort.date ?? 'off'}-${sort.size ?? 'off'}`}
              testId="worktrees-list"
              itemCount={sortedWorktrees.length}
              estimatedItemHeight={ESTIMATED_WORKTREE_ITEM_HEIGHT}
              windowStart={renderedWindow.start}
              onVisibleRange={handleVisibleRange}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                alignSelf: 'stretch',
                width: '100%',
                flexGrow: 1,
                minHeight: 0,
              }}
            >
              {sortedWorktrees.slice(renderedWindow.start, renderedWindow.end).map((worktree, offset) => {
                const index = renderedWindow.start + offset
                return (
                  <div
                    key={worktree.path}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      width: '100%',
                      alignSelf: 'stretch',
                      paddingBottom: 8,
                    }}
                  >
                    <WorktreeRow
                      worktree={worktree}
                      index={index}
                      projectFolderPath={projectFolderPath}
                      openWorktreeOptions={openWorktreeOptions}
                      lastOpenWorktreeTarget={lastOpenWorktreeTarget}
                      onOpenWorktree={onOpenWorktree}
                      onLinkWorktree={onLinkWorktree}
                      onSelectOpenWorktreeTarget={onSelectOpenWorktreeTarget}
                      onDeleteWorktree={onDeleteWorktree}
                    />
                  </div>
                )
              })}
            </virtual-list>
          )}
        </>
      )}
    </div>
  )
}
