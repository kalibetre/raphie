import { describe, expect, it } from 'vitest'
import {
  discoverAvailableOpenWorktreeOptions,
  getOpenWorktreeCommand,
  type WorktreeAvailabilityProbe,
} from '../../src/app/utils/openWorktree.ts'

describe('open worktree actions', () => {
  it('only includes installed macOS apps and built-in tools', async () => {
    const probe: WorktreeAvailabilityProbe = {
      hasCommand: () => false,
      hasApplication: async (application) => application !== 'Cursor',
    }

    expect(await discoverAvailableOpenWorktreeOptions('darwin', probe)).toEqual([
      { value: 'vscode', label: 'VS Code' },
      { value: 'zed', label: 'Zed' },
      { value: 'sublime', label: 'Sublime Text' },
      { value: 'intellij', label: 'IntelliJ IDEA' },
      { value: 'file-manager', label: 'Finder' },
      { value: 'terminal', label: 'Terminal' },
    ])
  })

  it('only includes available Linux commands', async () => {
    const available = new Set(['code', 'xdg-open', 'x-terminal-emulator'])
    const probe: WorktreeAvailabilityProbe = {
      hasCommand: (command) => available.has(command),
      hasApplication: async () => false,
    }

    expect(await discoverAvailableOpenWorktreeOptions('linux', probe)).toEqual([
      { value: 'vscode', label: 'VS Code' },
      { value: 'file-manager', label: 'File Manager' },
      { value: 'terminal', label: 'Terminal' },
    ])
  })

  it('builds direct macOS launcher commands', () => {
    expect(getOpenWorktreeCommand('vscode', '/tmp/my project', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', 'Visual Studio Code', '/tmp/my project'],
    })
    expect(getOpenWorktreeCommand('file-manager', '/tmp/my project', 'darwin')).toEqual({
      command: 'open',
      args: ['/tmp/my project'],
    })
    expect(getOpenWorktreeCommand('terminal', '/tmp/my project', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', 'Terminal', '/tmp/my project'],
    })
  })

  it('builds direct Windows launcher commands', () => {
    expect(getOpenWorktreeCommand('vscode', 'C:\\Users\\me\\my project', 'win32')).toEqual({
      command: 'code.exe',
      args: ['C:\\Users\\me\\my project'],
    })
    expect(getOpenWorktreeCommand('file-manager', 'C:\\Users\\me\\my project', 'win32')).toEqual({
      command: 'explorer.exe',
      args: ['C:\\Users\\me\\my project'],
    })
    expect(getOpenWorktreeCommand('terminal', 'C:\\Users\\me\\my project', 'win32')).toEqual({
      command: 'wt.exe',
      args: ['-d', 'C:\\Users\\me\\my project'],
    })
  })

  it('builds direct Linux launcher commands', () => {
    expect(getOpenWorktreeCommand('vscode', '/tmp/my project', 'linux')).toEqual({
      command: 'code',
      args: ['/tmp/my project'],
    })
    expect(getOpenWorktreeCommand('file-manager', '/tmp/my project', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/my project'],
    })
    expect(getOpenWorktreeCommand('terminal', '/tmp/my project', 'linux')).toEqual({
      command: 'x-terminal-emulator',
      args: ['--working-directory', '/tmp/my project'],
    })
  })
})
