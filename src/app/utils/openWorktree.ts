export type WorktreePlatform = 'darwin' | 'linux' | 'win32'

export type WorktreeOpenTarget =
  | 'cursor'
  | 'vscode'
  | 'zed'
  | 'sublime'
  | 'intellij'
  | 'file-manager'
  | 'terminal'

export interface WorktreeOpenOption {
  readonly value: WorktreeOpenTarget
  readonly label: string
}

export interface WorktreeAvailabilityProbe {
  readonly hasCommand: (command: string) => boolean
  readonly hasApplication: (application: string) => Promise<boolean>
}

export interface OpenWorktreeCommand {
  readonly command: string
  readonly args: readonly string[]
}

type EditorTarget = Exclude<WorktreeOpenTarget, 'file-manager' | 'terminal'>

const editorDefinitions = [
  {
    value: 'cursor',
    label: 'Cursor',
    application: 'Cursor',
    commands: { linux: 'cursor', win32: 'cursor.exe' },
  },
  {
    value: 'vscode',
    label: 'VS Code',
    application: 'Visual Studio Code',
    commands: { linux: 'code', win32: 'code.exe' },
  },
  {
    value: 'zed',
    label: 'Zed',
    application: 'Zed',
    commands: { linux: 'zed', win32: 'zed.exe' },
  },
  {
    value: 'sublime',
    label: 'Sublime Text',
    application: 'Sublime Text',
    commands: { linux: 'subl', win32: 'subl.exe' },
  },
  {
    value: 'intellij',
    label: 'IntelliJ IDEA',
    application: 'IntelliJ IDEA',
    commands: { linux: 'idea', win32: 'idea64.exe' },
  },
] as const satisfies ReadonlyArray<{
  readonly value: EditorTarget
  readonly label: string
  readonly application: string
  readonly commands: { readonly linux: string; readonly win32: string }
}>

const normalizePlatform = (platform: NodeJS.Platform): WorktreePlatform => {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'win32'
  return 'linux'
}

export const getCurrentWorktreePlatform = (): WorktreePlatform =>
  normalizePlatform(typeof process === 'undefined' ? 'darwin' : process.platform)

interface AvailabilityDefinition {
  readonly option: WorktreeOpenOption
  readonly command?: string
  readonly application?: string
}

const getAvailabilityDefinitions = (platform: WorktreePlatform): readonly AvailabilityDefinition[] => {
  const editors: readonly AvailabilityDefinition[] = editorDefinitions.map((editor) => ({
    option: { value: editor.value, label: editor.label },
    ...(platform === 'darwin' ? { application: editor.application } : { command: editor.commands[platform] }),
  }))

  const systemTools: readonly AvailabilityDefinition[] =
    platform === 'darwin'
      ? [
          { option: { value: 'file-manager', label: 'Finder' }, application: 'Finder' },
          { option: { value: 'terminal', label: 'Terminal' }, application: 'Terminal' },
        ]
      : platform === 'win32'
        ? [
            { option: { value: 'file-manager', label: 'File Explorer' }, command: 'explorer.exe' },
            { option: { value: 'terminal', label: 'Windows Terminal' }, command: 'wt.exe' },
          ]
        : [
            { option: { value: 'file-manager', label: 'File Manager' }, command: 'xdg-open' },
            { option: { value: 'terminal', label: 'Terminal' }, command: 'x-terminal-emulator' },
          ]

  return [...editors, ...systemTools]
}

const createSystemAvailabilityProbe = (): WorktreeAvailabilityProbe => ({
  hasCommand: (command) => typeof Bun !== 'undefined' && Bun.which(command) !== null,
  hasApplication: async (application) => {
    if (typeof Bun === 'undefined') return false

    const home = typeof process === 'undefined' ? null : process.env.HOME
    const applicationPaths = [
      `/Applications/${application}.app`,
      ...(home ? [`${home}/Applications/${application}.app`] : []),
      `/System/Applications/${application}.app`,
      ...(application === 'Finder' ? ['/System/Library/CoreServices/Finder.app'] : []),
      ...(application === 'Terminal' ? ['/System/Applications/Utilities/Terminal.app'] : []),
    ]

    for (const applicationPath of applicationPaths) {
      try {
        const process = Bun.spawn({
          cmd: ['/bin/test', '-d', applicationPath],
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
        })
        if ((await process.exited) === 0) return true
      } catch {
        // Try the next conventional application location.
      }
    }

    return false
  },
})

export const discoverAvailableOpenWorktreeOptions = async (
  platform: WorktreePlatform = getCurrentWorktreePlatform(),
  probe: WorktreeAvailabilityProbe = createSystemAvailabilityProbe(),
): Promise<readonly WorktreeOpenOption[]> => {
  const definitions = getAvailabilityDefinitions(platform)
  const available = await Promise.all(
    definitions.map(async (definition) => {
      const isAvailable = definition.application
        ? await probe.hasApplication(definition.application)
        : definition.command
          ? probe.hasCommand(definition.command)
          : false
      return isAvailable ? definition.option : null
    }),
  )
  return available.filter((option): option is WorktreeOpenOption => option !== null)
}

const getEditorCommand = (
  target: EditorTarget,
  path: string,
  platform: WorktreePlatform,
): OpenWorktreeCommand => {
  if (platform === 'darwin') {
    const editor = editorDefinitions.find((candidate) => candidate.value === target)
    if (!editor) throw new Error(`Unknown Worktree editor: ${target}`)
    return { command: 'open', args: ['-a', editor.application, path] }
  }

  const editor = editorDefinitions.find((candidate) => candidate.value === target)
  if (!editor) throw new Error(`Unknown Worktree editor: ${target}`)
  return { command: editor.commands[platform], args: [path] }
}

export const getOpenWorktreeCommand = (
  target: WorktreeOpenTarget,
  path: string,
  platform: WorktreePlatform = getCurrentWorktreePlatform(),
): OpenWorktreeCommand => {
  if (target === 'file-manager') {
    if (platform === 'darwin') return { command: 'open', args: [path] }
    if (platform === 'win32') return { command: 'explorer.exe', args: [path] }
    return { command: 'xdg-open', args: [path] }
  }

  if (target === 'terminal') {
    if (platform === 'darwin') return { command: 'open', args: ['-a', 'Terminal', path] }
    if (platform === 'win32') return { command: 'wt.exe', args: ['-d', path] }
    return { command: 'x-terminal-emulator', args: ['--working-directory', path] }
  }

  return getEditorCommand(target, path, platform)
}

/** Launch an external app without involving a shell or blocking the UI. */
export const openWorktree = (
  target: WorktreeOpenTarget,
  path: string,
  platform: WorktreePlatform = getCurrentWorktreePlatform(),
): boolean => {
  if (typeof Bun === 'undefined') return false

  const { command, args } = getOpenWorktreeCommand(target, path, platform)
  try {
    Bun.spawn({
      cmd: [command, ...args],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }).unref()
    return true
  } catch {
    return false
  }
}
