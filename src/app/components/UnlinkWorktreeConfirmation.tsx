import type { WorktreeUnlinkMode } from '../../core/index.ts'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

function UnlinkModeOption({
  mode,
  selectedMode,
  unlinking,
  title,
  description,
  onSelect,
}: {
  mode: WorktreeUnlinkMode
  selectedMode: WorktreeUnlinkMode | null
  unlinking: boolean
  title: string
  description: string
  onSelect: (mode: WorktreeUnlinkMode) => void
}) {
  return (
    <div
      testId={`unlink-worktree-${mode}-option`}
      role="button"
      aria-label={title}
      onClick={() => {
        if (!unlinking) onSelect(mode)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selectedMode === mode ? C.accent : C.border,
        backgroundColor: selectedMode === mode ? C.overlay : undefined,
        cursor: unlinking ? 'default' : 'pointer',
        opacity: unlinking ? 0.6 : 1,
      }}
    >
      <text style={{ fontSize: 12, color: C.text }}>{title}</text>
      <text style={{ fontSize: 11, color: C.ghost }}>{description}</text>
    </div>
  )
}

export function UnlinkWorktreeConfirmation({
  worktreePath,
  mode,
  unlinking,
  onSelectMode,
  onCancel,
  onConfirm,
}: {
  worktreePath: string
  mode: WorktreeUnlinkMode | null
  unlinking: boolean
  onSelectMode: (mode: WorktreeUnlinkMode) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      testId="unlink-worktree-confirmation-modal"
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
        testId="unlink-worktree-confirmation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 500,
          maxWidth: '100%',
          padding: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.border,
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
              backgroundColor: C.overlay,
              flexShrink: 0,
            }}
          >
            <Icon name="unlink" size={16} color={C.accent} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Unlink Worktree?</text>
            <text style={{ fontSize: 12, color: C.secondary }}>
              Choose what should happen to this Worktree&apos;s .env file.
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <UnlinkModeOption
            mode="copy"
            selectedMode={mode}
            unlinking={unlinking}
            title="Replace with a copy"
            description="Keep the Central env file's current values in a real .env. Future Central changes will not be shared."
            onSelect={onSelectMode}
          />
          <UnlinkModeOption
            mode="remove"
            selectedMode={mode}
            unlinking={unlinking}
            title="Remove .env"
            description="Delete the Worktree's .env entirely."
            onSelect={onSelectMode}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="unlink-worktree-cancel"
            label="Cancel Worktree unlinking"
            text="Cancel"
            variant="secondary"
            disabled={unlinking}
            onClick={onCancel}
          />
          <DialogButton
            testId="unlink-worktree-confirm"
            label={unlinking ? 'Unlinking Worktree' : mode === null ? 'Choose an unlink mode' : 'Unlink Worktree'}
            text={unlinking ? 'Unlinking…' : 'Unlink Worktree'}
            variant="primary"
            disabled={unlinking || mode === null}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}
