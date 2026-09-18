import type { ProjectRemovalMode } from '../../core/index.ts'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'

export function RemoveProjectConfirmation({
  removalMode,
  removalError,
  removalInFlight,
  onSelectMode,
  onCancel,
  onConfirm,
}: {
  removalMode: ProjectRemovalMode
  removalError: string | null
  removalInFlight: boolean
  onSelectMode: (mode: ProjectRemovalMode) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      testId="remove-project-confirmation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.sidebar,
        flexShrink: 0,
      }}
    >
      <text style={{ fontSize: 11, color: C.secondary }}>Remove this Project from Raphie?</text>
      <text style={{ fontSize: 10, color: C.ghost }}>Choose what to do with the project’s .env:</text>
      <div
        testId="remove-env-copy-option"
        onClick={() => {
          if (!removalInFlight) onSelectMode('copy')
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: 300,
          padding: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: removalMode === 'copy' ? C.accent : C.border,
          backgroundColor: removalMode === 'copy' ? C.overlay : undefined,
          cursor: 'pointer',
        }}
      >
        <text style={{ fontSize: 11, color: C.text }}>Copy .env into the project folder</text>
        <text style={{ fontSize: 10, color: C.ghost }}>Recommended: keep the project’s current env values.</text>
      </div>
      <div
        testId="remove-env-delete-option"
        onClick={() => {
          if (!removalInFlight) onSelectMode('remove')
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: 300,
          padding: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: removalMode === 'remove' ? C.accent : C.border,
          backgroundColor: removalMode === 'remove' ? C.overlay : undefined,
          cursor: 'pointer',
        }}
      >
        <text style={{ fontSize: 11, color: C.text }}>Remove .env entirely</text>
        <text style={{ fontSize: 10, color: C.ghost }}>Delete the project’s .env and Raphie’s Central copy.</text>
      </div>
      {removalError ? (
        <div
          testId="remove-project-error"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
            width: 300,
            padding: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.warning,
            backgroundColor: C.warningBg,
          }}
        >
          <Icon name="triangleAlert" size={14} color={C.warning} />
          <text style={{ fontSize: 11, color: C.text, flexGrow: 1, flexShrink: 1 }}>{removalError}</text>
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        <div
          testId="cancel-remove-project"
          onClick={() => {
            if (!removalInFlight) onCancel()
          }}
          style={{
            height: 26,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            hover: { backgroundColor: C.overlay },
          }}
        >
          <text style={{ fontSize: 12, color: C.secondary }}>Cancel</text>
        </div>
        <div
          testId="confirm-remove-project"
          onClick={onConfirm}
          style={{
            height: 26,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            backgroundColor: C.accent,
            opacity: removalInFlight ? 0.6 : 1,
          }}
        >
          <text style={{ fontSize: 12, color: C.onAccent }}>{removalInFlight ? 'Removing…' : 'Remove'}</text>
        </div>
      </div>
    </div>
  )
}
