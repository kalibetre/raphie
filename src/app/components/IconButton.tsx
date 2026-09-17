import type { IconName } from '../icons.tsx'
import { Icon } from '../icons.tsx'
import { C, type ThemeColor } from '../theme.ts'

export function IconButton({
  testId,
  label,
  icon,
  color = C.secondary,
  disabled = false,
  onClick,
}: {
  testId: string
  label: string
  icon: IconName
  color?: ThemeColor
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <div
      testId={testId}
      role="button"
      aria-label={label}
      onClick={() => {
        if (!disabled) onClick()
      }}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        hover: disabled ? undefined : { backgroundColor: C.overlay },
      }}
    >
      <Icon name={icon} size={14} color={color} />
    </div>
  )
}
