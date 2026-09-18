import { C } from '../theme.ts'

export function EnvFileBadge({ index }: { index: number }) {
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
        borderColor: C.warning,
        backgroundColor: C.warningBg,
      }}
    >
      <text style={{ fontSize: 10, color: C.warning }}>{'.env found'}</text>
    </div>
  )
}
