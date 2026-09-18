import type { Worktree } from '../core/Domain.ts'

export type WorktreeSortDirection = 'asc' | 'desc' | null

export interface WorktreeSort {
  readonly size: WorktreeSortDirection
  readonly date: WorktreeSortDirection
}

export const DEFAULT_WORKTREE_SORT: WorktreeSort = { date: 'desc', size: 'desc' }

export const cycleWorktreeSortDirection = (
  direction: WorktreeSortDirection,
): Exclude<WorktreeSortDirection, null> | null => {
  if (direction === 'desc') return 'asc'
  if (direction === 'asc') return null
  return 'desc'
}

const getSortValue = (worktree: Worktree, field: 'size' | 'date'): number | null => {
  if (field === 'size') return worktree.metadata?.size ?? null

  const date = worktree.metadata?.lastCommit?.date
  if (!date) return null
  const timestamp = new Date(date).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

const compareBy = (
  left: Worktree,
  right: Worktree,
  field: 'size' | 'date',
  direction: Exclude<WorktreeSortDirection, null>,
) => {
  const leftValue = getSortValue(left, field)
  const rightValue = getSortValue(right, field)
  if (leftValue === null && rightValue === null) return 0
  if (leftValue === null) return 1
  if (rightValue === null) return -1

  const comparison = leftValue - rightValue
  return (direction === 'asc' ? 1 : -1) * comparison
}

export const sortWorktrees = (worktrees: readonly Worktree[], sort: WorktreeSort): Worktree[] => {
  const criteria: ReadonlyArray<
    readonly [field: 'date' | 'size', direction: Exclude<WorktreeSortDirection, null>]
  > = [
    ...(sort.date ? ([['date', sort.date]] as const) : []),
    ...(sort.size ? ([['size', sort.size]] as const) : []),
  ]

  return worktrees
    .map((worktree, index) => ({ worktree, index }))
    .sort((left, right) => {
      for (const [field, direction] of criteria) {
        const comparison = compareBy(left.worktree, right.worktree, field, direction)
        if (comparison !== 0) return comparison
      }
      return left.index - right.index
    })
    .map(({ worktree }) => worktree)
}
