import type { EnvVar } from '../../core/index.ts'
import { ACTIONS_COLUMN_WIDTH, C, KEY_COLUMN_WIDTH } from '../theme.ts'
import { EnvVarRow } from './EnvVarRow.tsx'

export function EnvVarTable({
  envVars,
  revealedKeys,
  duplicateKeys,
  onToggleReveal,
  onCopy,
}: {
  envVars: EnvVar[]
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  onToggleReveal: (key: string) => void
  onCopy: (envVar: EnvVar) => void
}) {
  if (envVars.length === 0) {
    return (
      <text testId="envvar-empty-hint" style={{ fontSize: 12, color: C.ghost }}>
        No EnvVars in this Project's Central env file
      </text>
    )
  }

  return (
    <div
      testId="envvar-table"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: C.sidebar,
          borderBottomWidth: 1,
          borderColor: C.border,
        }}
      >
        <text style={{ fontSize: 11, color: C.secondary, width: KEY_COLUMN_WIDTH, flexShrink: 0 }}>Key</text>
        <text style={{ fontSize: 11, color: C.secondary, flexGrow: 1 }}>Value</text>
        <div style={{ width: ACTIONS_COLUMN_WIDTH, flexShrink: 0 }} />
      </div>
      {envVars.map((envVar, index) => (
        <EnvVarRow
          key={`${envVar.key}-${index}`}
          envVar={envVar}
          revealed={revealedKeys.has(envVar.key)}
          isDuplicate={duplicateKeys.has(envVar.key)}
          isLast={index === envVars.length - 1}
          onToggleReveal={() => onToggleReveal(envVar.key)}
          onCopy={() => onCopy(envVar)}
        />
      ))}
    </div>
  )
}
