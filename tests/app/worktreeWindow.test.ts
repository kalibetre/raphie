import { describe, expect, it } from 'vitest'
import {
  selectWorktreeWindow,
  selectWorktreeWindowAroundVisibleRange,
} from '../../src/app/worktreeWindow.ts'

describe('selectWorktreeWindow', () => {
  it('starts with enough rows to fill the initial viewport', () => {
    expect(selectWorktreeWindow(100, 0, 0)).toEqual({ start: 0, end: 12 })
  })

  it('keeps enough rows mounted around the native visible range', () => {
    expect(selectWorktreeWindowAroundVisibleRange(100, 40, 45)).toEqual({ start: 38, end: 50 })
  })

  it('clamps the window to the list size', () => {
    expect(selectWorktreeWindow(3, 2, 3)).toEqual({ start: 2, end: 3 })
    expect(selectWorktreeWindow(0, 0, 0)).toEqual({ start: 0, end: 0 })
  })
})
