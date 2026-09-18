import type { LinkWorktreeConflictError } from '../../core/index.ts'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function LinkWorktreeConfirmation({
  conflict,
  linking,
  onCancel,
  onLinkAnyway,
}: {
  conflict: LinkWorktreeConflictError
  linking: boolean
  onCancel: () => void
  onLinkAnyway: () => void
}) {
  return (
    <div
      testId="link-worktree-confirmation-modal"
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
        testId="link-worktree-confirmation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 500,
          maxWidth: '100%',
          padding: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.warning,
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
            <Icon name="triangleAlert" size={16} color={C.warning} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Existing .env found</text>
            <text style={{ fontSize: 12, color: C.secondary }}>
              Raphie will not replace a real Worktree .env without your confirmation.
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
          <text style={{ fontSize: 10, color: C.ghost }}>WORKTREE .ENV</text>
          <text style={{ fontSize: 12, color: C.text }}>{conflict.envFilePath}</text>
        </div>

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
          <text style={{ fontSize: 12, color: C.warning, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            Link anyway renames the existing file to a backup, then points .env to the Project’s Central env file.
          </text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="link-worktree-cancel"
            label="Cancel Worktree linking"
            text="Cancel"
            variant="secondary"
            disabled={linking}
            onClick={onCancel}
          />
          <DialogButton
            testId="link-worktree-anyway"
            label={linking ? 'Linking Worktree' : 'Link Worktree anyway'}
            text={linking ? 'Linking…' : 'Link anyway'}
            variant="primary"
            disabled={linking}
            onClick={onLinkAnyway}
          />
        </div>
      </div>
    </div>
  )
}
