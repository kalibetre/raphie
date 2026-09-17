import type { Worktree } from '../../core/index.ts'
import { C } from '../theme.ts'

export function WorktreeList({ worktrees }: { worktrees: Worktree[] }) {
  if (worktrees.length === 0) return null

  return (
    <div testId="worktrees-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <text style={{ fontSize: 13, color: C.secondary }}>Worktrees</text>
      <div
        testId="worktrees-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {worktrees.map((worktree, index) => (
          <div
            key={worktree.path}
            testId={`worktree-${index}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 10,
              paddingBottom: 10,
              borderBottomWidth: index === worktrees.length - 1 ? 0 : 1,
              borderColor: C.border,
              backgroundColor: C.raised,
            }}
          >
            <text
              testId={`worktree-path-${index}`}
              style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: C.text }}
            >
              {worktree.path}
            </text>
            <text
              testId={`worktree-status-${index}`}
              style={{ fontSize: 12, color: worktree.linked ? C.accent : C.secondary }}
            >
              {worktree.linked ? 'Linked' : 'Not Linked'}
            </text>
          </div>
        ))}
      </div>
    </div>
  )
}
