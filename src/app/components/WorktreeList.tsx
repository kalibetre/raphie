import type { Worktree } from '../../core/index.ts'
import { C } from '../theme.ts'

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

const formatCommitDate = (date: string) => {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function WorktreeRow({ worktree, index }: { worktree: Worktree; index: number }) {
  const commit = worktree.lastCommit

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
          <text style={{ fontSize: 11, color: C.ghost }}>{formatSize(worktree.size)}</text>
        </div>
        <text
          testId={`worktree-status-${index}`}
          style={{ fontSize: 12, color: worktree.linked ? C.accent : C.secondary }}
        >
          {worktree.linked ? 'Linked' : 'Not Linked'}
        </text>
      </div>

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
          <text style={{ fontSize: 11, color: C.text }}>{worktree.branch ?? 'Detached HEAD'}</text>
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
          <text style={{ fontSize: 11, color: C.text }}>{worktree.stagedChanges}</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
          <text style={{ fontSize: 11, color: C.secondary }}>Unstaged changes:</text>
          <text style={{ fontSize: 11, color: C.text }}>{worktree.unstagedChanges}</text>
        </div>
      </div>
    </div>
  )
}

export function WorktreeList({ worktrees, loading }: { worktrees: Worktree[]; loading: boolean }) {
  return (
    <div testId="worktrees-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loading ? (
        <text testId="worktrees-loading" style={{ fontSize: 12, color: C.ghost }}>
          Loading Worktrees…
        </text>
      ) : worktrees.length === 0 ? (
        <text testId="worktrees-empty" style={{ fontSize: 12, color: C.ghost }}>
          No Git Worktrees found.
        </text>
      ) : (
        <div
          testId="worktrees-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {worktrees.map((worktree, index) => (
            <WorktreeRow key={worktree.path} worktree={worktree} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}
