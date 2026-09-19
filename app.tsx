/**
 * raphie: env variable manager. Entry point only — see src/app/App.tsx.
 *
 * Desktop: bun run dev
 */

import { render } from '@gpuix/react'
import { App } from './src/app/App.tsx'
import { isCliInvocation, runCli } from './src/cli/index.ts'

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.isStandaloneExecutable || Bun.main === import.meta.path
    : typeof window !== 'undefined'

const args = typeof process === 'undefined' ? [] : process.argv.slice(2)

if (isCliInvocation(args)) {
  process.exitCode = await runCli(args)
} else if (isEntryPoint) {
  render(<App />, {
    title: 'Raphie',
    width: 900,
    height: 640,
    titlebarTransparent: true,
    windowBackground: 'blurred',
    trafficLightX: 16,
    trafficLightY: 17,
    focus: typeof process === 'undefined' || process.env.GPUIX_BACKGROUND !== '1',
  })
}
