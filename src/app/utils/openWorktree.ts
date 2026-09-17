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

export interface OpenWorktreeCommand {
  readonly command: string
  readonly args: readonly string[]
}

const editorOptions = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'zed', label: 'Zed' },
  { value: 'sublime', label: 'Sublime Text' },
  { value: 'intellij', label: 'IntelliJ IDEA' },
] as const satisfies readonly WorktreeOpenOption[]

const normalizePlatform = (platform: NodeJS.Platform): WorktreePlatform => {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'win32'
  return 'linux'
}

export const getCurrentWorktreePlatform = (): WorktreePlatform =>
  normalizePlatform(typeof process === 'undefined' ? 'darwin' : process.platform)

export const getOpenWorktreeOptions = (
  platform: WorktreePlatform = getCurrentWorktreePlatform(),
): readonly WorktreeOpenOption[] => [
  ...editorOptions,
  {
    value: 'file-manager',
    label: platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'File Manager',
  },
  { value: 'terminal', label: platform === 'win32' ? 'Windows Terminal' : 'Terminal' },
]

const getEditorCommand = (
  target: Exclude<WorktreeOpenTarget, 'file-manager' | 'terminal'>,
  path: string,
  platform: WorktreePlatform,
): OpenWorktreeCommand => {
  if (platform === 'darwin') {
    const appNames = {
      cursor: 'Cursor',
      vscode: 'Visual Studio Code',
      zed: 'Zed',
      sublime: 'Sublime Text',
      intellij: 'IntelliJ IDEA',
    } satisfies Record<typeof target, string>
    return { command: 'open', args: ['-a', appNames[target], path] }
  }

  if (platform === 'win32') {
    const executables = {
      cursor: 'cursor.exe',
      vscode: 'code.exe',
      zed: 'zed.exe',
      sublime: 'subl.exe',
      intellij: 'idea64.exe',
    } satisfies Record<typeof target, string>
    return { command: executables[target], args: [path] }
  }

  const executables = {
    cursor: 'cursor',
    vscode: 'code',
    zed: 'zed',
    sublime: 'subl',
    intellij: 'idea',
  } satisfies Record<typeof target, string>
  return { command: executables[target], args: [path] }
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
