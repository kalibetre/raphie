import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export function EnvImportModal({
  projectName,
  busy,
  error,
  onSkip,
  onImport,
}: {
  projectName: string
  busy: boolean
  error: string | null
  onSkip: () => void
  onImport: (deleteSourceFile: boolean) => void
}) {
  return (
    <div
      testId="env-import-modal"
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
        testId="env-import-dialog"
        style={{
          width: 480,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 20,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.raised,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 16, color: C.text }}>Import .env into the Vault?</text>
          <text style={{ fontSize: 12, lineHeight: 18, color: C.secondary }}>
            Raphie found an existing .env in {projectName}. Import its values into the encrypted local Profile.
          </text>
          <text style={{ fontSize: 11, lineHeight: 16, color: C.ghost }}>
            Values are encrypted before any optional source-file deletion. Raphie will not create a replacement .env.
          </text>
        </div>
        {error ? (
          <text testId="env-import-error" style={{ fontSize: 11, color: C.warning }}>
            {error}
          </text>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="env-import-skip"
            label="Skip .env import"
            text="Skip"
            variant="secondary"
            disabled={busy}
            onClick={onSkip}
          />
          <DialogButton
            testId="env-import-keep"
            label="Import .env and keep source file"
            text={busy ? 'Importing…' : 'Import and keep'}
            variant="secondary"
            disabled={busy}
            onClick={() => onImport(false)}
          />
          <DialogButton
            testId="env-import-delete"
            label="Import .env and delete source file"
            text={busy ? 'Importing…' : 'Import and delete'}
            variant="primary"
            disabled={busy}
            onClick={() => onImport(true)}
          />
        </div>
      </div>
    </div>
  )
}
