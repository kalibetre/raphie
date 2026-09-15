/** Colors and layout constants shared across every app component. One place to tune the look. */

export const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  topBar: '#181818',
  border: '#292929',
  raised: '#232323',
  overlay: '#E6EAF20D',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  ghost: '#5C5C5C',
  accent: '#E2795B',
  onAccent: '#17181C',
  warning: '#D9A03D',
  warningBg: '#D9A03D1A',
}

export const KEY_COLUMN_WIDTH = 240
export const ACTIONS_COLUMN_WIDTH = 28

export const DEFAULT_SIDEBAR_WIDTH = 260
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 440
export const RESIZE_HANDLE_WIDTH = 4

// 48, not a round 40: trafficLightY=17 plus the ~14px dot height centers on a
// 48px-tall bar. This is also the exact height GPUIX's own chat.tsx example
// uses with the same trafficLightY, so it's a calibrated value, not a guess.
export const TOP_BAR_HEIGHT = 48
// macOS draws the traffic lights over the app's top-left corner.
export const TITLEBAR_CLEARANCE = typeof process !== 'undefined' && process.platform === 'darwin' ? 86 : 14

export const MASKED_VALUE = '••••••••'
