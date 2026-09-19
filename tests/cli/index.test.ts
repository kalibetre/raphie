import { describe, expect, it } from 'vitest'
import { isCliInvocation, runCli } from '../../src/cli/index.ts'
import type { CliIo } from '../../src/cli/vault.ts'

const makeIo = () => {
  const output: string[] = []
  const errors: string[] = []
  const io: CliIo = {
    cwd: '/',
    write: (message) => output.push(message),
    error: (message) => errors.push(message),
    readSecret: async () => '',
    readStdin: async () => '',
  }
  return { io, output, errors }
}

describe('runCli', () => {
  it('opens the app only when no arguments are given', () => {
    expect(isCliInvocation([])).toBe(false)
    expect(isCliInvocation(['help'])).toBe(true)
    expect(isCliInvocation(['projct'])).toBe(true)
  })

  it.each([['help'], ['--help'], ['-h']])('prints usage for %s', async (flag) => {
    const { io, output, errors } = makeIo()

    await expect(runCli([flag], io)).resolves.toBe(0)
    expect(output.join('\n')).toContain('raphie project add')
    expect(output.join('\n')).toContain('raphie vault')
    expect(errors).toEqual([])
  })

  it('reports an unknown command with usage and a failure status', async () => {
    const { io, output, errors } = makeIo()

    await expect(runCli(['projct'], io)).resolves.toBe(2)
    expect(output).toEqual([])
    expect(errors.join('\n')).toContain('Usage:')
  })
})
