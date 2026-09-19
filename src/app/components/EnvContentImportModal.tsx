import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'
import { IconButton } from './IconButton.tsx'

export function EnvContentImportModal({
  content,
  busy,
  error,
  onChange,
  onCancel,
  onImport,
}: {
  content: string
  busy: boolean
  error: string | null
  onChange: (content: string) => void
  onCancel: () => void
  onImport: () => void
}) {
  return (
    <div
      testId="env-content-import-modal"
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
        testId="env-content-import-dialog"
        role="dialog"
        aria-label="Import Env Vars"
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
            <text style={{ fontSize: 16, color: C.text }}>Import Env Vars</text>
            <text style={{ fontSize: 11, lineHeight: 16, color: C.ghost }}>
              Paste the contents of an .env file. Values are encrypted in the Vault and no file is created.
            </text>
          </div>
          <IconButton testId="env-content-import-close" label="Close Env Var import" icon="x" onClick={onCancel} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 11, color: C.secondary }}>Env file contents</text>
          <textarea
            testId="env-content-import-input"
            aria-label="Env file contents"
            value={content}
            placeholder={'API_URL=https://example.com\nAPI_TOKEN=...'}
            autoFocus
            minRows={12}
            maxRows={20}
            onChange={(event) => onChange(event.value ?? '')}
            style={{
              width: '100%',
              minHeight: 240,
              padding: 10,
              borderWidth: 1,
              borderColor: error ? C.warning : C.border,
              borderRadius: 6,
              backgroundColor: C.canvas,
              color: C.text,
              fontSize: 13,
              lineHeight: 20,
            }}
          />
          {error ? (
            <text testId="env-content-import-error" style={{ fontSize: 11, color: C.warning }}>
              {error}
            </text>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="env-content-import-cancel"
            label="Cancel Env Var import"
            text="Cancel"
            variant="secondary"
            disabled={busy}
            onClick={onCancel}
          />
          <DialogButton
            testId="env-content-import-submit"
            label={busy ? 'Importing Env Vars' : 'Import Env Vars'}
            text={busy ? 'Importing…' : 'Import'}
            variant="primary"
            disabled={busy}
            onClick={onImport}
          />
        </div>
      </div>
    </div>
  )
}
