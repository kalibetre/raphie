import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import React, { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { EnvActionsMenu } from '../../src/app/components/EnvActionsMenu.tsx'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('EnvActionsMenu', () => {
  it('fires the reveal toggle when the action changes from Reveal to Hide', () => {
    const onToggleRevealAll = vi.fn()

    function Harness() {
      const [allEnvVarsRevealed, setAllEnvVarsRevealed] = useState(false)
      return (
        <EnvActionsMenu
          hasEnvVars
          allEnvVarsRevealed={allEnvVarsRevealed}
          vaultBacked
          onToggleRevealAll={() => {
            setAllEnvVarsRevealed((current) => !current)
            onToggleRevealAll()
          }}
          onStartImport={vi.fn()}
          onStartExport={vi.fn()}
          onStartAdd={vi.fn()}
        />
      )
    }

    const { render, renderer } = createTestRoot({ width: 800, height: 600 })
    render(<Harness />)

    const clickAction = () => {
      const trigger = renderer.findByTestId('env-actions-menu')!
      const triggerBounds = renderer.getElementBounds(trigger.id)!
      renderer.nativeSimulateClick(triggerBounds.x + 5, triggerBounds.y + 5)
      renderer.flush()

      const action = renderer.findByTestId('env-action-toggle-reveal')!
      const actionBounds = renderer.getElementBounds(action.id)!
      renderer.nativeSimulateClick(actionBounds.x + 5, actionBounds.y + 5)
      renderer.flush()
    }

    clickAction()
    clickAction()

    expect(onToggleRevealAll).toHaveBeenCalledTimes(2)
  })
})
