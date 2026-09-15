import { C } from '../theme.ts'

export function DialogButton({
  testId,
  label,
  text,
  variant,
  disabled,
  onClick,
}: {
  testId: string
  label: string
  text: string
  variant: 'primary' | 'secondary'
  disabled: boolean
  onClick: () => void
}) {
  const primary = variant === 'primary'

  return (
    <div
      testId={testId}
      role="button"
      aria-label={label}
      onClick={() => {
        if (!disabled) onClick()
      }}
      style={{
        height: 30,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        borderWidth: 1,
        borderColor: primary ? C.accent : C.border,
        backgroundColor: primary ? C.accent : C.raised,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <text style={{ fontSize: 12, color: primary ? C.onAccent : C.secondary }}>{text}</text>
    </div>
  )
}
