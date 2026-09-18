import { C } from '../theme.ts'

export function EnvFileBadge({ index, linked }: { index: number; linked: boolean }) {
  const color = linked ? C.accent : C.warning

  return (
    <div
      testId={`worktree-env-file-badge-${index}`}
      aria-label=".env found"
      style={{
        height: 18,
        paddingLeft: 6,
        paddingRight: 6,
        flexShrink: 0,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: color,
        backgroundColor: linked ? C.overlay : C.warningBg,
      }}
    >
      <text style={{ fontSize: 10, color }}>{'.env found'}</text>
    </div>
  )
}
