import { describe, expect, it } from 'vitest'
import { getOpenWorktreeCommand, getOpenWorktreeOptions } from '../../src/app/utils/openWorktree.ts'

describe('open worktree actions', () => {
  it('includes platform-specific file manager and terminal options', () => {
    expect(getOpenWorktreeOptions('darwin').slice(-2)).toEqual([
      { value: 'file-manager', label: 'Finder' },
      { value: 'terminal', label: 'Terminal' },
    ])
    expect(getOpenWorktreeOptions('win32').slice(-2)).toEqual([
      { value: 'file-manager', label: 'File Explorer' },
      { value: 'terminal', label: 'Windows Terminal' },
    ])
    expect(getOpenWorktreeOptions('linux').slice(-2)).toEqual([
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
