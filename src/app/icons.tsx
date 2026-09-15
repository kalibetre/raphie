import iconCopy from '../../assets/icons/copy.svg' with { type: 'text' }
import iconPanelLeft from '../../assets/icons/panel-left.svg' with { type: 'text' }
import iconTriangleAlert from '../../assets/icons/triangle-alert.svg' with { type: 'text' }
import iconX from '../../assets/icons/x.svg' with { type: 'text' }

// Icon source: Lucide (via `lucide-static`, vendored per-icon into assets/icons/),
// matching the icon set GPUIX's own example apps already standardize on.
// Add new icons the same way: copy the raw SVG from node_modules/lucide-static/icons/
// into assets/icons/, then add it to this map — one place to keep icon usage uniform.
const ICONS = {
  panelLeft: iconPanelLeft,
  copy: iconCopy,
  x: iconX,
  triangleAlert: iconTriangleAlert,
} as const

export function Icon({ name, size = 14, color }: { name: keyof typeof ICONS; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}
