import { describe, expect, it } from 'vitest'
import { isMainWorktreePath } from '../../src/app/worktreePath.ts'

describe('isMainWorktreePath', () => {
  it('matches Git’s main worktree when the Project path has a trailing separator', () => {
    expect(
      isMainWorktreePath(
        '/Users/kalibetre/Work/aai-labs/reception-assistant/reception-assistant',
        '/Users/kalibetre/Work/aai-labs/reception-assistant/reception-assistant/',
      ),
    ).toBe(true)
  })

  it('does not treat a secondary Worktree as the main Worktree', () => {
    expect(
      isMainWorktreePath(
        '/Users/kalibetre/.t3/worktrees/reception-assistant/t3code-fd8fad4b',
        '/Users/kalibetre/Work/aai-labs/reception-assistant/reception-assistant/',
      ),
    ).toBe(false)
  })
})
