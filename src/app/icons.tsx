import iconCopy from '../../assets/icons/copy.svg' with { type: 'text' }
import iconChevronDown from '../../assets/icons/chevron-down.svg' with { type: 'text' }
import iconCalendar from '../../assets/icons/calendar.svg' with { type: 'text' }
import iconFileMinus from '../../assets/icons/file-minus.svg' with { type: 'text' }
import iconFilePlus from '../../assets/icons/file-plus.svg' with { type: 'text' }
import iconGitBranch from '../../assets/icons/git-branch.svg' with { type: 'text' }
import iconGitCommit from '../../assets/icons/git-commit.svg' with { type: 'text' }
import iconHardDrive from '../../assets/icons/hard-drive.svg' with { type: 'text' }
import iconHouse from '../../assets/icons/house.svg' with { type: 'text' }
import iconImport from '../../assets/icons/import.svg' with { type: 'text' }
import iconLock from '../../assets/icons/lock.svg' with { type: 'text' }
import iconPanelLeft from '../../assets/icons/panel-left.svg' with { type: 'text' }
import iconPencil from '../../assets/icons/pencil.svg' with { type: 'text' }
import iconRefreshCw from '../../assets/icons/refresh-cw.svg' with { type: 'text' }
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
  calendar: iconCalendar,
  fileMinus: iconFileMinus,
  filePlus: iconFilePlus,
  gitBranch: iconGitBranch,
  gitCommit: iconGitCommit,
  hardDrive: iconHardDrive,
  house: iconHouse,
  import: iconImport,
  lock: iconLock,
  pencil: iconPencil,
  refreshCw: iconRefreshCw,
  trash2: iconTrash2,
  x: iconX,
  triangleAlert: iconTriangleAlert,
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}
