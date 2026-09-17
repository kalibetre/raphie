import type { Worktree } from '../../src/core/index.ts'
import { describe, expect, it } from 'vitest'
import { readWorktreeCache, writeWorktreeCache, WORKTREE_CACHE_TTL_MS } from '../../src/app/worktreeCache.ts'

const worktree: Worktree = {
  path: '/tmp/project',
  linked: true,
  metadata: null,
}

describe('worktree cache', () => {
  it('returns a cached snapshot without marking it stale within the TTL', () => {
    const cache = new Map()
    writeWorktreeCache(cache, 'project-1', [worktree], 1_000)

    expect(readWorktreeCache(cache, 'project-1', 1_000 + WORKTREE_CACHE_TTL_MS - 1)).toEqual({
      worktrees: [worktree],
      stale: false,
    })
  })

  it('keeps an expired snapshot available for stale-while-revalidate', () => {
    const cache = new Map()
    writeWorktreeCache(cache, 'project-1', [worktree], 1_000)

    expect(readWorktreeCache(cache, 'project-1', 1_000 + WORKTREE_CACHE_TTL_MS)).toEqual({
      worktrees: [worktree],
      stale: true,
    })
  })
})
