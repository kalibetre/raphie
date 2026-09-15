import { C } from '../theme.ts'

export function DuplicateBadge() {
  return (
    <div
      style={{
        flexShrink: 0,
        height: 16,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: C.warning,
        backgroundColor: C.warningBg,
      }}
    >
      <text style={{ fontSize: 9, color: C.warning }}>Duplicate</text>
    </div>
  )
}
