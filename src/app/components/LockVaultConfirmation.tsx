import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function LockVaultConfirmation({
  locking,
  onCancel,
  onConfirm,
}: {
  locking: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      testId="lock-vault-confirmation-modal"
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
        testId="lock-vault-confirmation"
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
        <text style={{ fontSize: 16, color: C.text }}>Lock Vault?</text>
        <text style={{ fontSize: 12, color: C.secondary }}>
          Locking also locks the Raphie CLI. You will need your Vault password to unlock it again.
        </text>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <DialogButton
            testId="lock-vault-cancel"
            label="Cancel locking the Vault"
            text="Cancel"
            variant="secondary"
            disabled={locking}
            onClick={onCancel}
          />
          <DialogButton
            testId="lock-vault-confirm"
            label={locking ? 'Locking Vault' : 'Lock Vault'}
            text={locking ? 'Locking…' : 'Lock'}
            variant="primary"
            disabled={locking}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}
