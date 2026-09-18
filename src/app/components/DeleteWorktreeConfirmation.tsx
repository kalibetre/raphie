import type { WorktreeRemovalFailure } from '../../core/index.ts'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function DeleteWorktreeConfirmation({
  worktreePath,
  error,
  deleting,
  onCancel,
  onConfirm,
}: {
  worktreePath: string
  error: WorktreeRemovalFailure | null
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
          gap: 16,
          width: 500,
          maxWidth: '100%',
          padding: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: error ? C.warning : C.border,
          backgroundColor: C.raised,
          boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.dialogShadow },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.warningBg,
              flexShrink: 0,
            }}
          >
            <Icon name="trash2" size={16} color={C.warning} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
              {error ? 'Worktree could not be deleted' : 'Delete Worktree?'}
            </text>
            <text style={{ fontSize: 12, color: C.secondary }}>
              {error ? 'Git rejected the deletion. Review the reason below.' : 'This action permanently removes the local Worktree files.'}
            </text>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.canvas,
          }}
        >
          <text style={{ fontSize: 10, color: C.ghost }}>WORKTREE</text>
          <text style={{ fontSize: 12, color: C.text }}>{worktreePath}</text>
        </div>

        {error ? (
          <div
            testId="delete-worktree-error"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: C.warning,
              backgroundColor: C.warningBg,
            }}
          >
            <Icon name="triangleAlert" size={15} color={C.warning} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexGrow: 1, minWidth: 0 }}>
              <text style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Why it failed</text>
              <text style={{ fontSize: 12, color: C.text }}>{error.message}</text>
              {error.detail ? <text style={{ fontSize: 11, color: C.secondary }}>{error.detail}</text> : null}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              padding: 12,
              borderRadius: 8,
              backgroundColor: C.warningBg,
            }}
          >
            <Icon name="triangleAlert" size={15} color={C.warning} />
            <text style={{ fontSize: 12, color: C.warning }}>
              All uncommitted and untracked files in this Worktree, including ignored files, will be permanently deleted.
              Its Git branch will be kept.
            </text>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
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
            label={deleting ? 'Deleting Worktree' : error ? 'Try deleting Worktree again' : 'Delete Worktree'}
            text={deleting ? 'Deleting…' : error ? 'Try again' : 'Delete Worktree'}
            variant="primary"
            disabled={deleting}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}
