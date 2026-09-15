import { C } from '../theme.ts'

export function Badge({ label }: { label: string }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.accent,
      }}
    >
      <text style={{ fontSize: 9, fontWeight: 600, color: C.onAccent }}>{label}</text>
    </div>
  )
}
