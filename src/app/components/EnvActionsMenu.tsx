import { Select, SelectContent, SelectItem, SelectTrigger } from '@gpuix/react/select'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'

type EnvAction = 'toggle-reveal' | 'import' | 'export' | 'add'

// This Select is a command menu rather than a persistent selection. Keeping
// it on a sentinel value ensures selecting the same action twice still emits
// onValueChange (for example, Reveal all followed by Hide all).
const ACTION_MENU_VALUE = '__env_actions__'

export function EnvActionsMenu({
  hasEnvVars,
  allEnvVarsRevealed,
  vaultBacked,
  onToggleRevealAll,
  onStartImport,
  onStartExport,
  onStartAdd,
}: {
  hasEnvVars: boolean
  allEnvVarsRevealed: boolean
  vaultBacked: boolean
  onToggleRevealAll: () => void
  onStartImport: () => void
  onStartExport: () => void
  onStartAdd: () => void
}) {
  const actions = [
    ...(hasEnvVars
      ? [{ value: 'toggle-reveal' as const, label: allEnvVarsRevealed ? 'Hide all' : 'Reveal all' }]
      : []),
    ...(vaultBacked ? [{ value: 'import' as const, label: 'Import' }] : []),
    ...(vaultBacked ? [{ value: 'export' as const, label: 'Export' }] : []),
    { value: 'add' as const, label: 'Add EnvVar' },
  ]

  return (
    <Select
      items={actions}
      value={ACTION_MENU_VALUE}
      onValueChange={(value) => {
        switch (value as EnvAction) {
          case 'toggle-reveal':
            onToggleRevealAll()
            break
          case 'import':
            onStartImport()
            break
          case 'export':
            onStartExport()
            break
          case 'add':
            onStartAdd()
            break
        }
      }}
      style={{ flexDirection: 'row', alignItems: 'center' }}
    >
      <SelectTrigger
        testId="env-actions-menu"
        aria-label="Env Var actions"
        style={{
          height: 28,
          paddingLeft: 10,
          paddingRight: 8,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          cursor: 'pointer',
          color: C.secondary,
          hover: { backgroundColor: C.overlay },
        }}
      >
        <text style={{ fontSize: 12, color: C.secondary }}>Actions</text>
        <Icon name="chevronDown" size={12} color={C.secondary} />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="end"
        sideOffset={4}
        style={{
          minWidth: 144,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 4,
          paddingRight: 4,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 7,
          backgroundColor: C.canvas,
        }}
      >
        {actions.map((action) => (
          <SelectItem
            key={action.value}
            value={action.value}
            testId={`env-action-${action.value}`}
            style={({ highlighted, selected }) => ({
              height: 28,
              paddingLeft: 8,
              paddingRight: 8,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
              backgroundColor: highlighted ? C.overlay : selected ? C.raised : C.canvas,
              cursor: 'pointer',
            })}
          >
            <text style={{ fontSize: 12, color: C.text }}>{action.label}</text>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
