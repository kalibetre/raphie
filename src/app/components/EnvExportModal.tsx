import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'
import { IconButton } from './IconButton.tsx'

export function EnvExportModal({
  content,
  copied,
  onCopy,
  onClose,
}: {
  content: string
  copied: boolean
  onCopy: () => void
  onClose: () => void
}) {
  return (
    <div
      testId="env-export-modal"
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
        testId="env-export-dialog"
        role="dialog"
        aria-label="Export Env Vars"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          width: 600,
          maxWidth: '100%',
          padding: 20,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.raised,
          boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.dialogShadow },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <text style={{ fontSize: 16, color: C.text }}>Export Env Vars</text>
            <text style={{ fontSize: 11, lineHeight: 16, color: C.ghost }}>
              This is a plaintext snapshot. Copy it only where it is safe to store or use.
            </text>
          </div>
          <IconButton testId="env-export-close" label="Close Env Var export" icon="x" onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 11, color: C.secondary }}>Env file contents</text>
          <textarea
            testId="env-export-input"
            aria-label="Exported Env Var contents"
            value={content}
            readOnly
            minRows={12}
            maxRows={20}
            style={{
              width: '100%',
              minHeight: 240,
              padding: 10,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 6,
              backgroundColor: C.canvas,
              color: C.text,
              fontSize: 13,
              lineHeight: 20,
              cursor: 'text',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="env-export-cancel"
            label="Close Env Var export"
            text="Close"
            variant="secondary"
            disabled={false}
            onClick={onClose}
          />
          <DialogButton
            testId="env-export-copy"
            label="Copy all Env Vars"
            text={copied ? 'Copied' : 'Copy all'}
            variant="primary"
            disabled={content.length === 0}
            onClick={onCopy}
          />
        </div>
      </div>
    </div>
  )
}
