/**
 * Drives the real app through the GPU test renderer, against a temp
 * RAPHIE_HOME so it never touches the developer's real ~/.config/raphie.
 *
 *   bun run test
 */

import { Command, FileSystem } from '@effect/platform'
import { BunContext } from '@effect/platform-bun'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { Effect } from 'effect'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../src/app/App.tsx'
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../../src/app/theme.ts'
import { listEnvVars, listProjects, run } from '../../src/core/index.ts'

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
const disposableFolders: string[] = []

beforeEach(async () => {
  home = await makeTempDir('raphie-app-home-')
  projectFolder = await makeTempDir('raphie-app-project-')
  process.env.RAPHIE_HOME = home
})

afterEach(async () => {
  delete process.env.RAPHIE_HOME
  await removeDir(home)
  await removeDir(projectFolder)
  for (const folder of disposableFolders.splice(0)) await removeDir(folder)
})

/** Swaps the global Bun for `bunStub` for the duration of `fn`, then restores it. */
async function withStubbedBun<A>(bunStub: unknown, fn: () => Promise<A> | A): Promise<A> {
  const originalBun = (globalThis as { Bun?: unknown }).Bun
  ;(globalThis as { Bun?: unknown }).Bun = bunStub
  try {
    return await fn()
  } finally {
    ;(globalThis as { Bun?: unknown }).Bun = originalBun
  }
}

/** Stubs the global Bun.$ so pickFolderNative resolves `result` without a real osascript dialog. */
const withStubbedPicker = <A,>(result: string | Error, fn: () => Promise<A> | A) =>
  withStubbedBun(
    { $: () => ({ text: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) }) },
    fn,
  )

/** Stubs the global Bun.$ so copyToClipboard's `pbcopy` shell-out records the copied value instead of touching the real clipboard. */
function withStubbedClipboard<A>(fn: (copiedValues: string[]) => Promise<A> | A): Promise<A> {
  const copiedValues: string[] = []
  return withStubbedBun(
    {
      $: (_strings: TemplateStringsArray, value: string) => {
        copiedValues.push(value)
        const promise = Promise.resolve()
        return Object.assign(promise, { quiet: () => promise })
      },
    },
    () => fn(copiedValues),
  )
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

const runGit = async (...args: string[]) => {
  const exitCode = await run(Command.exitCode(Command.make('git', ...args)))
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} exited with ${exitCode}`)
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

    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain(projectFolder)
    expect(painted).toContain(secondFolder)
    expect((await run(listProjects)).map((project) => project.folderPath)).toEqual([projectFolder, secondFolder])

    await removeDir(secondFolder)
  })

  it('leaves the project list untouched when registration fails', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()
    await waitForAppUpdate()
    renderer.flush()

    // Point RAPHIE_HOME at a file instead of a directory only after the
    // initial (successful) load, so just registerProject's own makeDirectory
    // call fails (ENOTDIR) — exercising the registration effect's .catch,
    // not the unrelated initial listProjects load.
    const blockedHome = `${home}/blocked`
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(blockedHome, 'a file, not a directory')
      }),
    )
    process.env.RAPHIE_HOME = blockedHome

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])

    await waitForAppUpdate()
    renderer.flush()

    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('Drag a project folder here')
    expect(painted).not.toContain(projectFolder)
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

  it('shows every git Worktree with its current Central env link status', async () => {
    const worktreeFolder = await makeTempDir('raphie-app-worktree-')
    const legacyEnvFolder = await makeTempDir('raphie-app-legacy-env-')
    disposableFolders.push(worktreeFolder)
    disposableFolders.push(legacyEnvFolder)
    await runGit('-C', projectFolder, 'init')
    await runGit('-C', projectFolder, 'config', 'user.email', 'raphie-tests@example.com')
    await runGit('-C', projectFolder, 'config', 'user.name', 'Raphie Tests')
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${projectFolder}/README.md`, 'initial\n')
      }),
    )
    await runGit('-C', projectFolder, 'add', 'README.md')
    await runGit('-C', projectFolder, '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')

    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.symlink(project!.centralEnvFile, `${projectFolder}/.env`)
      }),
    )
    await runGit('-C', projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${legacyEnvFolder}/.env`, 'LOCAL_ONLY=yes\n')
        yield* fs.symlink(`${legacyEnvFolder}/.env`, `${worktreeFolder}/.env`)
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const mainPath = await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* fs.realPath(projectFolder)
      }),
    )
    const additionalPath = await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* fs.realPath(worktreeFolder)
      }),
    )
    expect(renderer.findByTestId('tab-worktrees')).toBeDefined()
    expect(renderer.findByTestId('worktrees-section')).toBeUndefined()

    const app = await connectTest(renderer)
    await app.getByTestId('tab-worktrees').click()
    await waitForAppUpdate()
    renderer.flush()

    const worktreePainted = renderer.getPaintedText().join('\n')
    expect(renderer.findByTestId('worktrees-section')).toBeDefined()
    expect(worktreePainted).toContain('Worktrees')
    expect(worktreePainted).toContain(mainPath)
    expect(worktreePainted).toContain(additionalPath)
    expect(worktreePainted).toContain('Linked')
    expect(worktreePainted).toContain('Not Linked')
    expect(worktreePainted).toMatch(/\d+(?:\.\d+)? (?:B|KB|MB|GB|TB)/)
    expect(worktreePainted).toContain('main')
    expect(worktreePainted).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)
    expect(renderer.findByTestId('worktrees-list')?.customProps?.estimatedItemHeight).toBe(120)
    expect(worktreePainted).not.toContain('Branch:')
    expect(worktreePainted).not.toContain('Last commit date:')
    expect(worktreePainted).not.toContain('Staged changes:')
    expect(worktreePainted).not.toContain('Unstaged changes:')
    expect(renderer.findByTestId('worktree-size-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-branch-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-commit-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-commit-date-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-staged-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-unstaged-0')).toBeDefined()
    expect(renderer.findByTestId('worktree-open-1')).toBeDefined()
    expect(renderer.findByTestId('worktree-open-menu-1')).toBeDefined()
    expect(renderer.findByTestId('worktree-env-file-badge-0')).toBeUndefined()
    expect(renderer.findByTestId('worktree-env-file-badge-1')).toBeDefined()
    expect(renderer.findByTestId('delete-worktree-0')).toBeDefined()
    expect(renderer.findByTestId('delete-worktree-1')).toBeDefined()
    expect(renderer.findByTestId('worktrees-sort-size')).toBeDefined()
    expect(renderer.findByTestId('worktrees-sort-date')).toBeDefined()
    expect(renderer.findByTestId('worktrees-refresh')).toBeDefined()

    await app.getByTestId('worktrees-sort-size').click()
    await app.getByTestId('worktrees-sort-date').click()
    renderer.flush()

    await runGit('-C', projectFolder, 'worktree', 'lock', additionalPath)
    await app.getByTestId('delete-worktree-1').click()
    renderer.flush()
    expect(renderer.findByTestId('delete-worktree-confirmation')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('uncommitted and untracked files')
    await app.getByTestId('delete-worktree-confirm').click()
    await waitForAppUpdate()
    renderer.flush()
    expect(renderer.findByTestId('delete-worktree-error')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('Worktree marked as locked')
    expect(renderer.getPaintedText().join('\n')).toContain('cannot remove a locked working tree')
    await app.getByTestId('delete-worktree-force').click()
    await waitForAppUpdate()
    renderer.flush()
    expect(renderer.findByTestId('delete-worktree-confirmation')).toBeUndefined()

    await app.getByTestId('tab-env-vars').click()
    renderer.flush()
    expect(renderer.findByTestId('worktrees-section')).toBeUndefined()
    await app.close()
  })

  it('shows an empty Worktrees state for a non-git Project', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.findByTestId('worktrees-section')).toBeUndefined()
    expect(renderer.findByTestId('tab-worktrees')).toBeDefined()

    const app = await connectTest(renderer)
    await app.getByTestId('tab-worktrees').click()
    renderer.flush()
    expect(renderer.findByTestId('worktrees-empty')).toBeDefined()
    await app.close()
  })

  it('links a Worktree, then unlinks it by replacing .env with a copy', async () => {
    const worktreeFolder = await makeTempDir('raphie-app-worktree-')
    disposableFolders.push(worktreeFolder)
    await runGit('-C', projectFolder, 'init')
    await runGit('-C', projectFolder, 'config', 'user.email', 'raphie-tests@example.com')
    await runGit('-C', projectFolder, 'config', 'user.name', 'Raphie Tests')
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${projectFolder}/README.md`, 'initial\n')
      }),
    )
    await runGit('-C', projectFolder, 'add', 'README.md')
    await runGit('-C', projectFolder, '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')

    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    const centralValues = 'FROM_CENTRAL=yes\n'
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, centralValues)
      }),
    )
    await runGit('-C', projectFolder, 'worktree', 'add', '-b', 'feature', worktreeFolder)
    const original = 'LOCAL_ONLY=yes\n'
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${worktreeFolder}/.env`, original)
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('tab-worktrees').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.findByTestId('worktree-env-file-badge-0')).toBeUndefined()
    await app.getByTestId('link-worktree-0').click()
    await waitForAppUpdate()
    renderer.flush()
    expect(renderer.findByTestId('worktree-env-file-badge-0')).toBeUndefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.readLink(`${projectFolder}/.env`)).toBe(project!.centralEnvFile)
      }),
    )

    expect(renderer.findByTestId('worktree-env-file-badge-1')).toBeDefined()
    await app.getByTestId('link-worktree-1').click()
    await waitForAppUpdate()
    renderer.flush()
    expect(renderer.findByTestId('link-worktree-confirmation')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('Existing .env found')
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.readFileString(`${worktreeFolder}/.env`)).toBe(original)
      }),
    )

    await app.getByTestId('link-worktree-anyway').click()
    await waitForAppUpdate()
    renderer.flush()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.readLink(`${worktreeFolder}/.env`)).toBe(project!.centralEnvFile)
        expect(yield* fs.readFileString(`${worktreeFolder}/.env.backup`)).toBe(original)
      }),
    )
    expect(renderer.findByTestId('worktree-env-file-badge-1')).toBeUndefined()
    expect(renderer.findByTestId('link-worktree-confirmation')).toBeUndefined()

    await app.getByTestId('unlink-worktree-1').click()
    renderer.flush()
    expect(renderer.findByTestId('unlink-worktree-confirmation')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('Replace with a copy')
    expect(renderer.getPaintedText().join('\n')).toContain('Remove .env')

    await app.getByTestId('unlink-worktree-confirm').click()
    renderer.flush()
    expect(renderer.findByTestId('unlink-worktree-confirmation')).toBeDefined()

    await app.getByTestId('unlink-worktree-copy-option').click()
    await app.getByTestId('unlink-worktree-confirm').click()
    await waitForAppUpdate()
    renderer.flush()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        expect((yield* fs.readLink(`${worktreeFolder}/.env`).pipe(Effect.either))._tag).toBe('Left')
        expect(yield* fs.readFileString(`${worktreeFolder}/.env`)).toBe(centralValues)
      }),
    )
    expect(renderer.findByTestId('worktree-env-file-badge-1')).toBeDefined()
    expect(renderer.findByTestId('unlink-worktree-confirmation')).toBeUndefined()

    await app.getByTestId('unlink-worktree-0').click()
    await app.getByTestId('unlink-worktree-remove-option').click()
    await app.getByTestId('unlink-worktree-confirm').click()
    await waitForAppUpdate()
    renderer.flush()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.exists(`${projectFolder}/.env`)).toBe(false)
      }),
    )
    expect(renderer.findByTestId('worktree-env-file-badge-0')).toBeUndefined()
    expect(renderer.findByTestId('unlink-worktree-confirmation')).toBeUndefined()
    await app.close()
  })

  it('shows the selected Project’s EnvVars masked, and reveals a value on click', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'SECRET_KEY=supersecret\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    let painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('SECRET_KEY')
    expect(painted).not.toContain('supersecret')

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-value-SECRET_KEY').click()
    renderer.flush()

    painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('supersecret')

    await app.close()
  })

  it('scrolls a long EnvVars list in the Project detail viewport', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const envVars = Array.from({ length: 80 }, (_, index) => `KEY_${index}=value-${index}`).join('\n')
        yield* fs.writeFileString(project!.centralEnvFile, `${envVars}\n`)
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const tab = renderer.findByTestId('tab-env-vars')!
    const tabBefore = renderer.getElementBounds(tab.id)
    const content = renderer.findByTestId('project-detail-content')!
    const contentBounds = renderer.getElementBounds(content.id)!
    const before = renderer.getScrollOffset(content.id)
    expect(before).not.toBeNull()

    renderer.nativeSimulateScrollWheel(
      contentBounds.x + contentBounds.width / 2,
      contentBounds.y + contentBounds.height / 2,
      0,
      -400,
    )

    const after = renderer.getScrollOffset(content.id)
    expect(after).not.toBeNull()
    expect(after![1]).toBeLessThan(before![1])
    expect(renderer.getElementBounds(tab.id)).toEqual(tabBefore)
  })

  it('keeps the page header fixed in place after revealing a long EnvVar value', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        // A value with no natural break point can be wider than the whole
        // window — the header must not grow to fit it (regression: it used
        // to push "Remove Project" off-screen, see App.tsx main-pane minWidth).
        yield* fs.writeFileString(project!.centralEnvFile, `LONG_SECRET=${'x'.repeat(500)}\n`)
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const removeButtonBefore = renderer.getElementBounds(renderer.findByTestId('remove-project-button')!.id)!

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-value-LONG_SECRET').click()
    renderer.flush()

    const removeButtonAfter = renderer.getElementBounds(renderer.findByTestId('remove-project-button')!.id)!
    expect(removeButtonAfter).toEqual(removeButtonBefore)

    await app.close()
  })

  it('copies an EnvVar’s value to the clipboard without revealing it', async () =>
    withStubbedClipboard(async (copiedValues) => {
      const { render, renderer } = createTestRoot()
      render(<App />)
      renderer.flush()

      const sidebar = renderer.findByTestId('sidebar')!
      const bounds = renderer.getElementBounds(sidebar.id)!
      renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
      await waitForAppUpdate()
      renderer.flush()

      const [project] = await run(listProjects)
      expect(project).toBeDefined()
      await runFs(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(project!.centralEnvFile, 'SECRET_KEY=supersecret\n')
        }),
      )

      const row = findByTestIdPrefix(renderer, 'project-')
      const rowBounds = renderer.getElementBounds(row.id)!
      renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
      await waitForAppUpdate()
      renderer.flush()

      const app = await connectTest(renderer)
      await app.getByTestId('envvar-copy-SECRET_KEY').click()
      renderer.flush()

      expect(copiedValues).toContain('supersecret')
      expect(renderer.getPaintedText().join('\n')).not.toContain('supersecret')

      await app.close()
    }))

  it('shows a copy-confirmation toast that can be dismissed immediately', async () =>
    withStubbedClipboard(async () => {
      const { render, renderer } = createTestRoot()
      render(<App />)
      renderer.flush()

      const sidebar = renderer.findByTestId('sidebar')!
      const bounds = renderer.getElementBounds(sidebar.id)!
      renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
      await waitForAppUpdate()
      renderer.flush()

      const [project] = await run(listProjects)
      expect(project).toBeDefined()
      await runFs(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(project!.centralEnvFile, 'SECRET_KEY=supersecret\n')
        }),
      )

      const row = findByTestIdPrefix(renderer, 'project-')
      const rowBounds = renderer.getElementBounds(row.id)!
      renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
      await waitForAppUpdate()
      renderer.flush()

      const app = await connectTest(renderer)
      await app.getByTestId('envvar-copy-SECRET_KEY').click()
      renderer.flush()

      expect(renderer.findByTestId('toast')).toBeDefined()
      expect(renderer.getPaintedText().join('\n')).toContain('Copied SECRET_KEY to clipboard')

      await app.getByTestId('toast-dismiss').click()
      renderer.flush()

      expect(renderer.findByTestId('toast')).toBeUndefined()

      await app.close()
    }))

  it('shows a hint when the selected Project has no EnvVars', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain("No EnvVars in this Project's Central env file")
  })

  it('warns about duplicate EnvVar keys and badges every occurrence', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'DUPLICATE_KEY=first\nDUPLICATE_KEY=second\nUNIQUE_KEY=only\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.findByTestId('duplicate-keys-warning')).toBeDefined()
    const painted = renderer.getPaintedText()
    expect(painted.join('\n')).toContain('Duplicate EnvVars found. Remove or rename them below.')
    expect(painted.join('\n')).toContain('DUPLICATE_KEY')
    // One "Duplicate" badge per duplicated row (two DUPLICATE_KEY rows), none on UNIQUE_KEY.
    expect(painted.filter((text) => text === 'Duplicate')).toHaveLength(2)
  })

  it('searches EnvVars by key or value without changing action targets', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'FIRST=one\nSECOND=two\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-search').fill('TWO')
    renderer.flush()

    expect(renderer.findByTestId('envvar-row-FIRST')).toBeUndefined()
    expect(renderer.findByTestId('envvar-row-SECOND')).toBeDefined()

    await app.getByTestId('envvar-edit-SECOND').click()
    renderer.flush()
    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('SECOND')
    expect(painted).toContain('two')
    await app.getByTestId('envvar-editor-close').click()
    await app.close()
  })

  it('cancels out of the remove-Project confirmation without removing anything', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('remove-project-button').click()
    renderer.flush()
    expect(renderer.findByTestId('remove-project-confirmation')).toBeDefined()

    await app.getByTestId('cancel-remove-project').click()
    renderer.flush()

    expect(renderer.findByTestId('remove-project-confirmation')).toBeUndefined()
    expect(renderer.findByTestId('remove-project-button')).toBeDefined()
    expect(await run(listProjects)).toHaveLength(1)

    await app.close()
  })

  it('edits an EnvVar key and multiline value through an explicit modal', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'SECRET_KEY=old-value\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-edit-SECRET_KEY').click()
    renderer.flush()

    expect(renderer.findByTestId('envvar-editor-modal')).toBeDefined()
    expect(renderer.findByTestId('envvar-editor-value')?.type).toBe('textarea')

    await app.getByTestId('envvar-editor-key').fill('RENAMED_KEY')
    await app.getByTestId('envvar-editor-value').fill('first line\nsecond line')
    await app.getByTestId('envvar-editor-save').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([
      { key: 'RENAMED_KEY', value: 'first line\nsecond line' },
    ])
    expect(renderer.getPaintedText().join('\n')).toContain('RENAMED_KEY')
    expect(renderer.getPaintedText().join('\n')).toContain('Saved RENAMED_KEY')

    expect(renderer.findByTestId('envvar-editor-modal')).toBeUndefined()

    await app.close()
  })

  it('adds a new EnvVar through the editor modal', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('add-envvar-button').click()
    await app.getByTestId('envvar-editor-key').fill('NEW_KEY')
    await app.getByTestId('envvar-editor-value').fill('new value')
    await app.getByTestId('envvar-editor-save').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([{ key: 'NEW_KEY', value: 'new value' }])
    expect(renderer.getPaintedText().join('\n')).toContain('NEW_KEY')

    expect(renderer.findByTestId('envvar-editor-modal')).toBeUndefined()
    await app.close()
  })

  it('rejects empty EnvVar values when adding or editing', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'EXISTING=original\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-edit-EXISTING').click()
    await app.getByTestId('envvar-editor-value').fill('')
    await app.getByTestId('envvar-editor-save').click()
    renderer.flush()

    expect(renderer.findByTestId('envvar-editor-modal')).toBeDefined()
    expect(renderer.findByTestId('envvar-editor-validation-error')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('EnvVar value cannot be empty')
    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([{ key: 'EXISTING', value: 'original' }])

    await app.getByTestId('envvar-editor-close').click()
    await app.getByTestId('add-envvar-button').click()
    await app.getByTestId('envvar-editor-key').fill('NEW_KEY')
    await app.getByTestId('envvar-editor-value').fill('')
    await app.getByTestId('envvar-editor-save').click()
    renderer.flush()

    expect(renderer.findByTestId('envvar-editor-modal')).toBeDefined()
    expect(renderer.findByTestId('envvar-editor-validation-error')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('EnvVar value cannot be empty')
    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([{ key: 'EXISTING', value: 'original' }])

    await app.getByTestId('envvar-editor-close').click()
    await app.close()
  })

  it('rejects a duplicate EnvVar key and shows a toast error', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'FIRST=one\nSECOND=two\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-edit-FIRST').click()
    await app.getByTestId('envvar-editor-key').fill('SECOND')
    await app.getByTestId('envvar-editor-save').click()
    renderer.flush()

    expect(renderer.findByTestId('envvar-editor-modal')).toBeDefined()
    expect(renderer.findByTestId('envvar-editor-validation-error')).toBeDefined()
    expect(renderer.getPaintedText().join('\n')).toContain('Duplicate EnvVar key "SECOND" already exists')
    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([
      { key: 'FIRST', value: 'one' },
      { key: 'SECOND', value: 'two' },
    ])

    await app.getByTestId('envvar-editor-close').click()
    await app.close()
  })

  it('requires confirmation before deleting an EnvVar', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'KEEP=yes\nREMOVE=gone\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    await waitForAppUpdate()
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('envvar-delete-REMOVE').click()
    renderer.flush()
    expect(renderer.findByTestId('delete-envvar-confirmation')).toBeDefined()
    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([
      { key: 'KEEP', value: 'yes' },
      { key: 'REMOVE', value: 'gone' },
    ])

    await app.getByTestId('delete-envvar-cancel').click()
    renderer.flush()
    expect(renderer.findByTestId('delete-envvar-confirmation')).toBeUndefined()
    expect(renderer.findByTestId('envvar-delete-REMOVE')).toBeDefined()

    await app.getByTestId('envvar-delete-REMOVE').click()
    await app.getByTestId('delete-envvar-confirm').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.findByTestId('delete-envvar-confirmation')).toBeUndefined()
    expect(await run(listEnvVars(project!.centralEnvFile))).toEqual([{ key: 'KEEP', value: 'yes' }])
    expect(renderer.getPaintedText().join('\n')).toContain('Deleted REMOVE')

    await app.close()
  })

  it('removes the Project .env entirely instead of copying it, when that mode is selected', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, 'REMOVE_ME=1\n')
        yield* fs.writeFileString(`${projectFolder}/.env`, 'LOCAL=1\n')
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('remove-project-button').click()
    await app.getByTestId('remove-env-delete-option').click()
    await app.getByTestId('confirm-remove-project').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(await run(listProjects)).toEqual([])
    expect(
      await runFs(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return yield* fs.exists(`${projectFolder}/.env`)
        }),
      ),
    ).toBe(false)

    await app.close()
  })

  it('removes the selected Project and copies its Central env into the project folder', async () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebar = renderer.findByTestId('sidebar')!
    const bounds = renderer.getElementBounds(sidebar.id)!
    renderer.nativeSimulateFileDrop(bounds.x + 5, bounds.y + 5, [projectFolder])
    await waitForAppUpdate()
    renderer.flush()

    const [project] = await run(listProjects)
    expect(project).toBeDefined()
    const envContent = 'FROM_CENTRAL=1\n'
    await runFs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(project!.centralEnvFile, envContent)
      }),
    )

    const row = findByTestIdPrefix(renderer, 'project-')
    const rowBounds = renderer.getElementBounds(row.id)!
    renderer.nativeSimulateClick(rowBounds.x + 5, rowBounds.y + 5)
    renderer.flush()

    const app = await connectTest(renderer)
    await app.getByTestId('remove-project-button').click()
    // 'copy' is already the default mode — click it explicitly anyway, so
    // this exercises the option's own click handler rather than relying on
    // initial state.
    await app.getByTestId('remove-env-copy-option').click()
    await app.getByTestId('confirm-remove-project').click()
    await waitForAppUpdate()
    renderer.flush()

    expect(renderer.getPaintedText().join('\n')).toContain('Select a project')
    expect(renderer.getPaintedText().join('\n')).not.toContain(projectFolder)
    expect(await run(listProjects)).toEqual([])
    expect(
      await runFs(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return {
            centralExists: yield* fs.exists(project!.centralEnvFile),
            projectEnv: yield* fs.readFileString(`${projectFolder}/.env`),
          }
        }),
      ),
    ).toEqual({ centralExists: false, projectEnv: envContent })

    await app.close()
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

  it('ignores mouse moves over the resize handle without a preceding mouse down', () => {
    const { render, renderer } = createTestRoot()
    render(<App />)
    renderer.flush()

    const sidebarBefore = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    const handleBounds = renderer.getElementBounds(renderer.findByTestId('sidebar-resize-handle')!.id)!

    renderer.nativeSimulateMouseMove(handleBounds.x + 80, handleBounds.y + 100)
    renderer.flush()

    const sidebarAfter = renderer.getElementBounds(renderer.findByTestId('sidebar')!.id)!
    expect(sidebarAfter.width).toBe(sidebarBefore.width)
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
