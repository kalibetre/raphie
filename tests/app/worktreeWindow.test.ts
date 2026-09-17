import { describe, expect, it } from 'vitest'
import { selectWorktreeWindow } from '../../src/app/worktreeWindow.ts'

describe('selectWorktreeWindow', () => {
  it('starts with a small window when the list is first mounted', () => {
    expect(selectWorktreeWindow(100, 0, 0)).toEqual({ start: 0, end: 8 })
  })

  it('keeps enough rows mounted around the native visible range', () => {
    expect(selectWorktreeWindow(100, 40, 45)).toEqual({ start: 40, end: 48 })
  })

  it('clamps the window to the list size', () => {
    expect(selectWorktreeWindow(3, 2, 3)).toEqual({ start: 2, end: 3 })
    expect(selectWorktreeWindow(0, 0, 0)).toEqual({ start: 0, end: 0 })
  })
})
