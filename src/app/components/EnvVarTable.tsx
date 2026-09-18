import type { EnvVar } from '../../core/index.ts'
import { ACTIONS_COLUMN_WIDTH, C, KEY_COLUMN_WIDTH } from '../theme.ts'
import { filterEnvVars } from '../utils/filterEnvVars.ts'
import { EnvVarRow } from './EnvVarRow.tsx'

export function EnvVarTable({
  envVars,
  revealedKeys,
  duplicateKeys,
  searchQuery,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}: {
  envVars: EnvVar[]
  revealedKeys: Set<string>
  duplicateKeys: Set<string>
  searchQuery: string
  onToggleReveal: (key: string) => void
  onCopy: (envVar: EnvVar) => void
  onEdit: (index: number) => void
  onDelete: (index: number) => void
}) {
  if (envVars.length === 0) {
    return (
      <text testId="envvar-empty-hint" style={{ fontSize: 12, color: C.ghost }}>
        No EnvVars in this Project's Central env file
      </text>
    )
  }

  const visibleEnvVars = filterEnvVars(envVars, searchQuery)

  if (visibleEnvVars.length === 0) {
    return (
      <text testId="envvar-no-search-results" style={{ fontSize: 12, color: C.ghost }}>
        No matching EnvVars
      </text>
    )
  }

  return (
    <div
      testId="envvar-table"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
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
      {visibleEnvVars.map(({ envVar, index }, visibleIndex) => (
        <EnvVarRow
          key={`${envVar.key}-${index}`}
          envVar={envVar}
          index={index}
          revealed={revealedKeys.has(envVar.key)}
          isDuplicate={duplicateKeys.has(envVar.key)}
          isLast={visibleIndex === visibleEnvVars.length - 1}
          onToggleReveal={() => onToggleReveal(envVar.key)}
          onCopy={() => onCopy(envVar)}
          onEdit={() => onEdit(index)}
          onDelete={() => onDelete(index)}
        />
      ))}
    </div>
  )
}
