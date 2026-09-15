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
import { listProjects, run } from '../../src/core/index.ts'

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

/** Stubs the global Bun.$ so pickFolderNative resolves `result` without a real osascript dialog. */
async function withStubbedPicker<A>(result: string | Error, fn: () => Promise<A> | A): Promise<A> {
  const originalBun = (globalThis as { Bun?: unknown }).Bun
  ;(globalThis as { Bun?: unknown }).Bun = {
    $: () => ({ text: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) }),
  }
  try {
    return await fn()
  } finally {
    ;(globalThis as { Bun?: unknown }).Bun = originalBun
  }
}

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

const waitForAppUpdate = () => new Promise((resolve) => setTimeout(resolve, 50))

async function submitRegistration(renderer: ReturnType<typeof createTestRoot>['renderer']) {
  const app = await connectTest(renderer)
  await app.getByTestId('register-project-button').click()
  await waitForAppUpdate()
  renderer.flush()
  await app.close()
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

    await waitForAppUpdate()
    renderer.flush()
    await submitRegistration(renderer)

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

    await waitForAppUpdate()
    renderer.flush()
    await submitRegistration(renderer)
    await submitRegistration(renderer)

    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain(projectFolder)
    expect(painted).toContain(secondFolder)
    expect((await run(listProjects)).map((project) => project.folderPath)).toEqual([projectFolder, secondFolder])

    await removeDir(secondFolder)
  })

  it('does not persist a duplicate Project when registration is submitted twice', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const sidebarBounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(sidebarBounds.x + 5, sidebarBounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const button = renderer.findByTestId('register-project-button')!
    const buttonBounds = renderer.getElementBounds(button.id)!
    renderer.nativeSimulateClick(buttonBounds.x + 5, buttonBounds.y + 5)
    renderer.nativeSimulateClick(buttonBounds.x + 5, buttonBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    expect(await run(listProjects)).toHaveLength(1)
  })

  it('lets the user set a Project display name before registration', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])

    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('registration-name').fill('Personal Raphie')
    await app.getByTestId('register-project-button').click()

    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain('Personal Raphie')
    await app.close()
  })

  it('shows the selected project’s name and location in the main pane and top bar', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()
    await submitRegistration(renderer)

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
    await waitForAppUpdate()
    renderer.flush()
    await submitRegistration(renderer)
    await submitRegistration(renderer)

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

  it('registers the folder chosen through "Add Project" (native picker)', async () =>
    withStubbedPicker(`${projectFolder}\n`, async () => {
      const { render, renderer } = createTestRoot()
      render(<App />)
      renderer.flush()

      const addProjectBounds = renderer.getElementBounds(renderer.findByTestId('add-project-button')!.id)!
      renderer.nativeSimulateClick(addProjectBounds.x + 5, addProjectBounds.y + 5)

      await waitForAppUpdate()
      renderer.flush()
      await submitRegistration(renderer)

      expect(renderer.getPaintedText().join('\n')).toContain(projectFolder)
    }))

  it('adds no Project when "Add Project" is cancelled', async () =>
    withStubbedPicker(new Error('user cancelled'), async () => {
      const { render, renderer } = createTestRoot()
      render(<App />)
      renderer.flush()

      const addProjectBounds = renderer.getElementBounds(renderer.findByTestId('add-project-button')!.id)!
      renderer.nativeSimulateClick(addProjectBounds.x + 5, addProjectBounds.y + 5)

      await waitForAppUpdate()
      renderer.flush()

      expect(renderer.getPaintedText().join('\n')).toContain('Drag a project folder here')
    }))

  it('ignores a file-drop event with no paths', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [])

    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain('Drag a project folder here')
  })
})
