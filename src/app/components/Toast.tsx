import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      testId="toast"
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 12,
        paddingRight: 8,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.raised,
      }}
    >
      <text style={{ fontSize: 12, color: C.text }}>{message}</text>
      <div
        testId="toast-dismiss"
        onClick={onDismiss}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          hover: { backgroundColor: C.overlay },
        }}
      >
        <Icon name="x" size={11} color={C.secondary} />
      </div>
    </div>
  )
}
