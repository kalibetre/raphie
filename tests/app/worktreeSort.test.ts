import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../src/core/Domain.ts'
import {
  DEFAULT_WORKTREE_SORT,
  cycleWorktreeSortDirection,
  sortWorktrees,
  type WorktreeSort,
} from '../../src/app/worktreeSort.ts'

const worktree = (path: string, size: number | null, date: string | null = null): Worktree => ({
  path,
  linked: false,
  metadata:
    size === null
      ? null
      : {
          size,
          branch: 'main',
          lastCommit: date
            ? { hash: 'abc1234', subject: 'commit', date }
            : null,
          stagedChanges: 0,
          unstagedChanges: 0,
        },
})

describe('sortWorktrees', () => {
  it('sorts known sizes from largest to smallest and keeps loading rows last', () => {
    const worktrees = [worktree('small', 10), worktree('loading', null), worktree('large', 30)]

    expect(sortWorktrees(worktrees, { date: null, size: 'desc' }).map(({ path }) => path)).toEqual([
      'large',
      'small',
      'loading',
    ])
  })

  it('sorts sizes from smallest to largest', () => {
    const worktrees = [worktree('large', 30), worktree('small', 10), worktree('medium', 20)]

    expect(sortWorktrees(worktrees, { date: null, size: 'asc' }).map(({ path }) => path)).toEqual([
      'small',
      'medium',
      'large',
    ])
  })

  it('sorts commit dates in both directions and keeps missing commits last', () => {
    const worktrees = [
      worktree('old', 10, '2026-09-01T10:00:00Z'),
      worktree('none', 20),
      worktree('new', 30, '2026-09-18T10:00:00Z'),
    ]

    expect(sortWorktrees(worktrees, { date: 'asc', size: null }).map(({ path }) => path)).toEqual([
      'old',
      'new',
      'none',
    ])
    expect(sortWorktrees(worktrees, { date: 'desc', size: null }).map(({ path }) => path)).toEqual([
      'new',
      'old',
      'none',
    ])
  })

  it('uses newest commits first and largest size as the default tie-breaker', () => {
    const worktrees = [
      worktree('same-date-small', 10, '2026-09-18T10:00:00Z'),
      worktree('old', 100, '2026-09-01T10:00:00Z'),
      worktree('same-date-large', 30, '2026-09-18T10:00:00Z'),
    ]

    expect(sortWorktrees(worktrees, DEFAULT_WORKTREE_SORT).map(({ path }) => path)).toEqual([
      'same-date-large',
      'same-date-small',
      'old',
    ])
  })

  it('combines active date and size directions and preserves order when both are off', () => {
    const worktrees = [
      worktree('small-new', 10, '2026-09-18T10:00:00Z'),
      worktree('large-old', 30, '2026-09-01T10:00:00Z'),
      worktree('medium-new', 20, '2026-09-18T10:00:00Z'),
    ]

    const sort: WorktreeSort = { date: 'asc', size: 'desc' }
    expect(sortWorktrees(worktrees, sort).map(({ path }) => path)).toEqual([
      'large-old',
      'medium-new',
      'small-new',
    ])
    expect(sortWorktrees(worktrees, { date: null, size: null }).map(({ path }) => path)).toEqual([
      'small-new',
      'large-old',
      'medium-new',
    ])
  })

  it('cycles each button from descending to ascending to off', () => {
    expect(cycleWorktreeSortDirection('desc')).toBe('asc')
    expect(cycleWorktreeSortDirection('asc')).toBe(null)
    expect(cycleWorktreeSortDirection(null)).toBe('desc')
  })
})
