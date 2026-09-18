import type { Worktree } from '../core/Domain.ts'

export type WorktreeSort = 'default' | 'size-asc' | 'size-desc' | 'date-asc' | 'date-desc'

const getSortValue = (worktree: Worktree, sort: WorktreeSort): number | null => {
  if (sort === 'size-asc' || sort === 'size-desc') return worktree.metadata?.size ?? null
  if (sort === 'date-asc' || sort === 'date-desc') {
    const date = worktree.metadata?.lastCommit?.date
    if (!date) return null
    const timestamp = new Date(date).getTime()
    return Number.isNaN(timestamp) ? null : timestamp
  }
  return null
}

export const sortWorktrees = (worktrees: readonly Worktree[], sort: WorktreeSort): Worktree[] => {
  if (sort === 'default') return [...worktrees]

  const direction = sort.endsWith('-asc') ? 1 : -1
  return worktrees
    .map((worktree, index) => ({ worktree, index, value: getSortValue(worktree, sort) }))
    .sort((left, right) => {
      if (left.value === null && right.value === null) return left.index - right.index
      if (left.value === null) return 1
      if (right.value === null) return -1
      return (left.value - right.value) * direction || left.index - right.index
    })
    .map(({ worktree }) => worktree)
}
