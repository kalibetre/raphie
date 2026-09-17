export const INITIAL_WORKTREE_WINDOW_SIZE = 8

export interface WorktreeWindow {
  readonly start: number
  readonly end: number
}

export const selectWorktreeWindow = (
  itemCount: number,
  requestedStart: number,
  requestedEnd: number,
): WorktreeWindow => {
  if (itemCount <= 0) return { start: 0, end: 0 }

  const lastIndex = itemCount - 1
  const start = Math.max(0, Math.min(lastIndex, Math.floor(requestedStart)))
  const minimumEnd = Math.min(itemCount, start + INITIAL_WORKTREE_WINDOW_SIZE)
  const end = Math.min(itemCount, Math.max(minimumEnd, Math.floor(requestedEnd)))
  return { start, end }
}
