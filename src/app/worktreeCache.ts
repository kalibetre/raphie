import type { Worktree } from '../core/index.ts'

export const WORKTREE_CACHE_TTL_MS = 30_000

export interface WorktreeCacheEntry {
  readonly worktrees: Worktree[]
  readonly loadedAt: number
}

export type WorktreeCache = Map<string, WorktreeCacheEntry>

export const readWorktreeCache = (cache: WorktreeCache, projectId: string, now = Date.now()) => {
  const entry = cache.get(projectId)
  if (!entry) return null

  return {
    worktrees: entry.worktrees,
    stale: now - entry.loadedAt >= WORKTREE_CACHE_TTL_MS,
  }
}

export const writeWorktreeCache = (
  cache: WorktreeCache,
  projectId: string,
  worktrees: Worktree[],
  loadedAt = Date.now(),
) => {
  cache.set(projectId, { worktrees, loadedAt })
}
