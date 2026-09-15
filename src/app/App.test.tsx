/**
 * Drives the real app through the GPU test renderer, against a temp
 * RAPHIE_HOME so it never touches the developer's real ~/.config/raphie.
 *
 *   bun run test
 */

import { FileSystem } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { Effect } from 'effect'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App.tsx'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const runFs = <A,>(effect: Effect.Effect<A, unknown, FileSystem.FileSystem>) =>
  Effect.runPromise(Effect.provide(effect, BunContext.layer))

let home: string
let projectFolder: string

beforeEach(async () => {
  home = await runFs(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectory({ prefix: 'raphie-app-home-' })
  }))
  projectFolder = await runFs(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectory({ prefix: 'raphie-app-project-' })
  }))
  process.env.RAPHIE_HOME = home
})

afterEach(async () => {
  delete process.env.RAPHIE_HOME
  await runFs(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(home, { recursive: true })
    yield* fs.remove(projectFolder, { recursive: true })
  }))
})

describeNative('Raphie App', () => {
  it('shows the empty-state hint with no registered projects', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)

    expect(renderer.getPaintedText().join('\n')).toContain('Drag a project folder here')
  })

  it('registers a project dropped anywhere on the window', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    // onFileDrop doesn't bubble, so the drop must land on an element that
    // actually carries the handler — the sidebar (or main-pane), not the
    // top bar and not their non-listening children.
    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])

    // registerProject crosses an async boundary (Effect.runPromise); poll for
    // the resulting state update instead of asserting immediately.
    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain(projectFolder)
  })

  it('registers every path from a single multi-folder drop', async () => {
    const secondFolder = await runFs(Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.makeTempDirectory({ prefix: 'raphie-app-project-' })
    }))

    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder, secondFolder])

    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()

    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain(projectFolder)
    expect(painted).toContain(secondFolder)

    await runFs(Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(secondFolder, { recursive: true })
    }))
  })
})
