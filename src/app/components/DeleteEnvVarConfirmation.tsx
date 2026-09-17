import type { EnvVar } from '../../core/index.ts'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function DeleteEnvVarConfirmation({
  envVar,
  deleting,
  onCancel,
  onConfirm,
}: {
  envVar: EnvVar
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      testId="delete-envvar-confirmation-modal"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: C.dialogScrim,
        pointerEvents: 'auto',
      }}
    >
      <div
        testId="delete-envvar-confirmation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 380,
          maxWidth: '100%',
          padding: 20,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.raised,
          boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.dialogShadow },
        }}
      >
        <text style={{ fontSize: 16, color: C.text }}>Delete EnvVar?</text>
        <text style={{ fontSize: 12, color: C.secondary }}>
          {'Delete ' + envVar.key + ' from this Project’s Central env file?'}
        </text>
        <text style={{ fontSize: 11, color: C.ghost }}>This action cannot be undone.</text>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <DialogButton
            testId="delete-envvar-cancel"
            label="Cancel EnvVar deletion"
            text="Cancel"
            variant="secondary"
            disabled={deleting}
            onClick={onCancel}
          />
          <DialogButton
            testId="delete-envvar-confirm"
            label={deleting ? 'Deleting EnvVar' : 'Delete EnvVar'}
            text={deleting ? 'Deleting…' : 'Delete'}
            variant="primary"
            disabled={deleting}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}
