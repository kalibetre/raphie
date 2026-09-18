import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function DeleteWorktreeConfirmation({
  worktreePath,
  deleting,
  onCancel,
  onConfirm,
}: {
  worktreePath: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      testId="delete-worktree-confirmation-modal"
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
        testId="delete-worktree-confirmation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 460,
          maxWidth: '100%',
          padding: 20,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.raised,
          boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.dialogShadow },
        }}
      >
        <text style={{ fontSize: 16, color: C.text }}>Delete Worktree?</text>
        <text style={{ fontSize: 12, color: C.secondary }}>{worktreePath}</text>
        <text style={{ fontSize: 11, color: C.warning }}>
          All files in this Worktree, including uncommitted and untracked files, will be permanently deleted. Its Git
          branch will be kept.
        </text>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <DialogButton
            testId="delete-worktree-cancel"
            label="Cancel Worktree deletion"
            text="Cancel"
            variant="secondary"
            disabled={deleting}
            onClick={onCancel}
          />
          <DialogButton
            testId="delete-worktree-confirm"
            label={deleting ? 'Deleting Worktree' : 'Delete Worktree'}
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
