import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../src/core/Domain.ts'
import { sortWorktrees } from '../../src/app/worktreeSort.ts'

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

    expect(sortWorktrees(worktrees, 'size-desc').map(({ path }) => path)).toEqual(['large', 'small', 'loading'])
  })

  it('sorts sizes from smallest to largest', () => {
    const worktrees = [worktree('large', 30), worktree('small', 10), worktree('medium', 20)]

    expect(sortWorktrees(worktrees, 'size-asc').map(({ path }) => path)).toEqual(['small', 'medium', 'large'])
  })

  it('sorts commit dates in both directions and keeps missing commits last', () => {
    const worktrees = [
      worktree('old', 10, '2026-09-01T10:00:00Z'),
      worktree('none', 20),
      worktree('new', 30, '2026-09-18T10:00:00Z'),
    ]

    expect(sortWorktrees(worktrees, 'date-asc').map(({ path }) => path)).toEqual(['old', 'new', 'none'])
    expect(sortWorktrees(worktrees, 'date-desc').map(({ path }) => path)).toEqual(['new', 'old', 'none'])
  })

  it('preserves the original order for the default sort and ties', () => {
    const worktrees = [worktree('first', 10), worktree('second', 10)]

    expect(sortWorktrees(worktrees, 'default').map(({ path }) => path)).toEqual(['first', 'second'])
    expect(sortWorktrees(worktrees, 'size-asc').map(({ path }) => path)).toEqual(['first', 'second'])
  })
})
