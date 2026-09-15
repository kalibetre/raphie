import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'

export function DuplicateKeysWarning({ duplicateKeys }: { duplicateKeys: Set<string> }) {
  if (duplicateKeys.size === 0) return null

  return (
    <div
      testId="duplicate-keys-warning"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.warning,
        backgroundColor: C.warningBg,
      }}
    >
      <Icon name="triangleAlert" size={14} color={C.warning} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <text style={{ fontSize: 12, color: C.text }}>Duplicate EnvVars found. Remove or rename them below.</text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[...duplicateKeys].map((key) => (
            <div
              key={key}
              style={{
                height: 18,
                paddingLeft: 6,
                paddingRight: 6,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: C.warning,
                backgroundColor: C.canvas,
              }}
            >
              <text style={{ fontSize: 10, color: C.warning }}>{key}</text>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
