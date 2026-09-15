import { C } from '../theme.ts'

export function RemoveProjectButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <div
      testId="remove-project-button"
      onClick={() => {
        if (!disabled) onClick()
      }}
      style={{
        height: 26,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        borderWidth: 1,
        borderColor: C.border,
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
        hover: { backgroundColor: C.overlay },
      }}
    >
      <text style={{ fontSize: 12, color: C.secondary }}>Remove Project</text>
    </div>
  )
}
