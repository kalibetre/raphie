import iconCopy from '../../assets/icons/copy.svg' with { type: 'text' }
import iconChevronDown from '../../assets/icons/chevron-down.svg' with { type: 'text' }
import iconPanelLeft from '../../assets/icons/panel-left.svg' with { type: 'text' }
import iconPencil from '../../assets/icons/pencil.svg' with { type: 'text' }
import iconTriangleAlert from '../../assets/icons/triangle-alert.svg' with { type: 'text' }
import iconTrash2 from '../../assets/icons/trash-2.svg' with { type: 'text' }
import iconX from '../../assets/icons/x.svg' with { type: 'text' }

// Icon source: Lucide (via `lucide-static`, vendored per-icon into assets/icons/),
// matching the icon set GPUIX's own example apps already standardize on.
// Add new icons the same way: copy the raw SVG from node_modules/lucide-static/icons/
// into assets/icons/, then add it to this map — one place to keep icon usage uniform.
const ICONS = {
  panelLeft: iconPanelLeft,
  copy: iconCopy,
  chevronDown: iconChevronDown,
  pencil: iconPencil,
  trash2: iconTrash2,
  x: iconX,
  triangleAlert: iconTriangleAlert,
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}
