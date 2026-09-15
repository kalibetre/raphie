import { useRef } from 'react'
import { C, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, RESIZE_HANDLE_WIDTH } from '../theme.ts'

/**
 * A node listening for both onMouseDown and onMouseMove captures the
 * pointer, so onMouseMove/onMouseUp keep firing even once the drag leaves
 * this thin hitbox — no window-level listener needed (see GPUIX README's
 * "capture the pointer" section).
 */
export function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      testId="sidebar-resize-handle"
      onMouseDown={(event) => {
        drag.current = { startX: event.x ?? 0, startWidth: width }
      }}
      onMouseMove={(event) => {
        if (!drag.current || event.x === undefined) return
        const next = drag.current.startWidth + (event.x - drag.current.startX)
        onResize(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)))
      }}
      onMouseUp={() => {
        drag.current = null
      }}
      style={{
        width: RESIZE_HANDLE_WIDTH,
        flexShrink: 0,
        height: '100%',
        cursor: 'col-resize',
        borderRightWidth: 1,
        borderColor: C.border,
        hover: { backgroundColor: C.accent, borderColor: C.accent },
      }}
    />
  )
}
