import type { Worktree } from '../../core/index.ts'
import { useEffect, useState } from 'react'
import { C } from '../theme.ts'
import { INITIAL_WORKTREE_WINDOW_SIZE, selectWorktreeWindow, type WorktreeWindow } from '../worktreeWindow.ts'

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
        gap: 4,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 6,
      }}
    >
      <Skeleton width={180} />
      <Skeleton width={280} />
      <Skeleton width={220} />
      <Skeleton width={90} />
      <Skeleton width={110} />
    </div>
  )
}

function WorktreeRow({ worktree, index }: { worktree: Worktree; index: number }) {
  const metadata = worktree.metadata
  const commit = metadata?.lastCommit

  return (
    <div
      testId={`worktree-${index}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: C.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <text testId={`worktree-path-${index}`} style={{ fontSize: 12, color: C.text }}>
            {worktree.path}
          </text>
          {metadata ? <text style={{ fontSize: 11, color: C.ghost }}>{formatSize(metadata.size)}</text> : <Skeleton width={42} />}
        </div>
        <text
          testId={`worktree-status-${index}`}
          style={{ fontSize: 12, color: worktree.linked ? C.accent : C.secondary }}
        >
          {worktree.linked ? 'Linked' : 'Not Linked'}
        </text>
      </div>

      {metadata ? (
        <div
          testId={`worktree-details-${index}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>Branch:</text>
            <text style={{ fontSize: 11, color: C.text }}>{metadata.branch ?? 'Detached HEAD'}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>Last commit:</text>
            <text style={{ fontSize: 11, color: C.text }}>
              {commit ? `${commit.hash} · ${commit.subject}` : 'No commits'}
            </text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>Last commit date:</text>
            <text testId={`worktree-commit-date-${index}`} style={{ fontSize: 11, color: C.text }}>
              {commit ? formatCommitDate(commit.date) : 'No commits'}
            </text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>Staged changes:</text>
            <text style={{ fontSize: 11, color: C.text }}>{metadata.stagedChanges}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>Unstaged changes:</text>
            <text style={{ fontSize: 11, color: C.text }}>{metadata.unstagedChanges}</text>
          </div>
        </div>
      ) : (
        <WorktreeMetadataSkeleton index={index} />
      )}
    </div>
  )
}

export function WorktreeList({ worktrees, loading }: { worktrees: Worktree[]; loading: boolean }) {
  const [window, setWindow] = useState<WorktreeWindow>(() =>
    selectWorktreeWindow(worktrees.length, 0, INITIAL_WORKTREE_WINDOW_SIZE),
  )
  const renderedWindow = selectWorktreeWindow(worktrees.length, window.start, window.end)

  useEffect(() => {
    setWindow((current) => selectWorktreeWindow(worktrees.length, current.start, current.end))
  }, [worktrees.length])

  const handleVisibleRange = (event: { startIndex?: number; endIndex?: number }) => {
    if (event.startIndex === undefined || event.endIndex === undefined) return
    setWindow((current) => {
      const next = selectWorktreeWindow(worktrees.length, event.startIndex!, event.endIndex!)
      return current.start === next.start && current.end === next.end ? current : next
    })
  }

  return (
    <div
      testId="worktrees-section"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1, minHeight: 0 }}
    >
      {loading ? (
        <text testId="worktrees-loading" style={{ fontSize: 12, color: C.ghost }}>
          Loading Worktrees…
        </text>
      ) : worktrees.length === 0 ? (
        <text testId="worktrees-empty" style={{ fontSize: 12, color: C.ghost }}>
          No Git Worktrees found.
        </text>
      ) : (
        <virtual-list
          testId="worktrees-list"
          itemCount={worktrees.length}
          estimatedItemHeight={210}
          windowStart={renderedWindow.start}
          onVisibleRange={handleVisibleRange}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          {worktrees.slice(renderedWindow.start, renderedWindow.end).map((worktree, offset) => (
            <WorktreeRow
              key={worktree.path}
              worktree={worktree}
              index={renderedWindow.start + offset}
            />
          ))}
        </virtual-list>
      )}
    </div>
  )
}
