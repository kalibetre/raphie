// Keep enough compact cards mounted to fill a tall content viewport before
// the native list has emitted its first visible-range update.
export const INITIAL_WORKTREE_WINDOW_SIZE = 12
// Keep a couple of rows on either side of the visible range so a scroll does
// not replace every mounted row at the exact viewport boundary.
export const WORKTREE_WINDOW_OVERSCAN = 2
// Includes the compact card height and the wrapper's bottom spacing.
export const ESTIMATED_WORKTREE_ITEM_HEIGHT = 120

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

export const selectWorktreeWindowAroundVisibleRange = (
  itemCount: number,
  visibleStart: number,
  visibleEnd: number,
): WorktreeWindow =>
  selectWorktreeWindow(
    itemCount,
    visibleStart - WORKTREE_WINDOW_OVERSCAN,
    visibleEnd + WORKTREE_WINDOW_OVERSCAN,
  )
