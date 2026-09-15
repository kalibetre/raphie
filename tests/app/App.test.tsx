/**
 * Drives the real app through the GPU test renderer, against a temp
 * RAPHIE_HOME so it never touches the developer's real ~/.config/raphie.
 *
 *   bun run test
 */

import { FileSystem } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { Effect } from 'effect'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../../src/app/App.tsx'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const runFs = <A,>(effect: Effect.Effect<A, unknown, FileSystem.FileSystem>) =>
  Effect.runPromise(Effect.provide(effect, BunContext.layer))

const makeTempDir = (prefix: string) =>
  runFs(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.makeTempDirectory({ prefix })
    }),
  )

const removeDir = (path: string) =>
  runFs(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(path, { recursive: true })
    }),
  )

let home: string
let projectFolder: string

beforeEach(async () => {
  home = await makeTempDir('raphie-app-home-')
  projectFolder = await makeTempDir('raphie-app-project-')
  process.env.RAPHIE_HOME = home
})

afterEach(async () => {
  delete process.env.RAPHIE_HOME
  await removeDir(home)
  await removeDir(projectFolder)
})

/** No wildcard lookup on the test renderer, so walk the retained tree by hand. */
function findByTestIdPrefix(renderer: ReturnType<typeof createTestRoot>['renderer'], prefix: string) {
  const stack = [renderer.getRoot()]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.testId?.startsWith(prefix)) return node
    for (const childId of node.children) {
      const child = renderer.getElement(childId)
      if (child) stack.push(child)
    }
  }
  throw new Error(`No element with testId prefix "${prefix}" found`)
}

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
    const secondFolder = await makeTempDir('raphie-app-project-')

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

    await removeDir(secondFolder)
  })

  it('shows the selected project’s name and location in the main pane and top bar', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain('Select a project')

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    renderer.flush()

    const painted = renderer.getPaintedText()
    expect(painted).not.toContain('Select a project')
    // Appears once in the sidebar row and once in the main pane once selected.
    expect(painted.filter((text) => text === projectFolder)).toHaveLength(2)

    const projectName = projectFolder.split('/').pop()
    // Sidebar row, main pane heading, and the top-bar breadcrumb.
    expect(painted.filter((text) => text === projectName)).toHaveLength(3)
    expect(renderer.findByTestId('title-bar-project-name')).toBeDefined()
  })

  it('filters the project list by name or folder path', async () => {
    const secondFolder = await makeTempDir('raphie-app-second-')

    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder, secondFolder])
    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()

    const app = await connectTest(renderer)
    const firstName = projectFolder.split('/').pop()!
    const secondName = secondFolder.split('/').pop()!

    await app.getByTestId('project-search').fill(firstName)
    renderer.flush()
    let painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain(firstName)
    expect(painted).not.toContain(secondName)

    await app.getByTestId('project-search').fill('no-project-matches-this-query')
    renderer.flush()
    expect(renderer.getPaintedText().join('\n')).toContain('No matches')

    await app.getByTestId('project-search').fill('')
    renderer.flush()
    painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain(firstName)
    expect(painted).toContain(secondName)

    await app.close()
    await removeDir(secondFolder)
  })

  it('resizes the sidebar by dragging the handle', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebarBefore = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    const handleBounds = renderer.getElementBounds(renderer.findByTestId('sidebar-resize-handle')!.id)!

    renderer.nativeSimulateMouseDown(handleBounds.x + 1, handleBounds.y + 100)
    renderer.nativeSimulateMouseMove(handleBounds.x + 81, handleBounds.y + 100)
    renderer.nativeSimulateMouseUp(handleBounds.x + 81, handleBounds.y + 100)
    renderer.flush()

    const sidebarAfter = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    expect(sidebarAfter.width).toBe(sidebarBefore.width + 80)
  })

  it('clamps sidebar resize to the minimum width', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const handleBounds = renderer.getElementBounds(renderer.findByTestId('sidebar-resize-handle')!.id)!

    renderer.nativeSimulateMouseDown(handleBounds.x + 1, handleBounds.y + 100)
    renderer.nativeSimulateMouseMove(handleBounds.x + 1 - 10_000, handleBounds.y + 100)
    renderer.nativeSimulateMouseUp(handleBounds.x + 1 - 10_000, handleBounds.y + 100)
    renderer.flush()

    const sidebarAfter = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    expect(sidebarAfter.width).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('clamps sidebar resize to the maximum width', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const handleBounds = renderer.getElementBounds(renderer.findByTestId('sidebar-resize-handle')!.id)!

    renderer.nativeSimulateMouseDown(handleBounds.x + 1, handleBounds.y + 100)
    renderer.nativeSimulateMouseMove(handleBounds.x + 1 + 10_000, handleBounds.y + 100)
    renderer.nativeSimulateMouseUp(handleBounds.x + 1 + 10_000, handleBounds.y + 100)
    renderer.flush()

    const sidebarAfter = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    expect(sidebarAfter.width).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('collapses the sidebar, expanding the main pane to fill the freed space', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const mainPaneBefore = renderer.getElementBounds(renderer.findByTestId('main-pane')!.id)!
    const toggleBounds = renderer.getElementBounds(renderer.findByTestId('sidebar-toggle')!.id)!

    // Motion animations run on their own clock; drive it explicitly instead
    // of waiting on real time (see GPUIX README's "Capture exact frames").
    renderer.clockPause()
    renderer.nativeSimulateClick(toggleBounds.x + 5, toggleBounds.y + 5)
    renderer.clockFastForward(250)
    renderer.flush()

    const mainPaneAfter = renderer.getElementBounds(renderer.findByTestId('main-pane')!.id)!
    expect(mainPaneAfter.width).toBeGreaterThan(mainPaneBefore.width)

    // Toggling again expands the sidebar back and shrinks the main pane.
    renderer.nativeSimulateClick(toggleBounds.x + 5, toggleBounds.y + 5)
    renderer.clockFastForward(250)
    renderer.flush()

    const mainPaneRestored = renderer.getElementBounds(renderer.findByTestId('main-pane')!.id)!
    expect(mainPaneRestored.width).toBe(mainPaneBefore.width)
  })
})
