import type { EnvVar } from '../../core/index.ts'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'
import { IconButton } from './IconButton.tsx'

export interface EnvVarEditorValidationError {
  readonly field: 'key' | 'value'
  readonly message: string
}

export function EnvVarEditorModal({
  mode,
  envVar,
  validationError,
  saving,
  onKeyChange,
  onValueChange,
  onSave,
  onClose,
}: {
  mode: 'add' | 'edit'
  envVar: EnvVar
  validationError: EnvVarEditorValidationError | null
  saving: boolean
  onKeyChange: (key: string) => void
  onValueChange: (value: string) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div
      testId="envvar-editor-modal"
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
        testId="envvar-editor-dialog"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 480,
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
            <text style={{ fontSize: 16, color: C.text }}>{mode === 'add' ? 'Add EnvVar' : 'Edit EnvVar'}</text>
            <text style={{ fontSize: 11, color: C.ghost }}>Changes are saved to the Central env file immediately.</text>
          </div>
          <IconButton testId="envvar-editor-close" label="Close EnvVar editor" icon="x" onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 11, color: C.secondary }}>Key</text>
          <input
            testId="envvar-editor-key"
            value={envVar.key}
            placeholder="ENV_VAR_NAME"
            autoFocus
            onChange={(event) => onKeyChange(event.value ?? '')}
            style={{
              width: '100%',
              minHeight: 34,
              paddingLeft: 10,
              paddingRight: 10,
              borderWidth: 1,
              borderColor: validationError?.field === 'key' ? C.warning : C.border,
              borderRadius: 6,
              backgroundColor: C.canvas,
              color: C.text,
              fontSize: 13,
            }}
          />
          {validationError?.field === 'key' ? (
            <text testId="envvar-editor-validation-error" style={{ fontSize: 11, color: C.warning }}>
              {validationError.message}
            </text>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 11, color: C.secondary }}>Value</text>
          <textarea
            testId="envvar-editor-value"
            value={envVar.value}
            placeholder="Value"
            minRows={6}
            maxRows={12}
            onChange={(event) => onValueChange(event.value ?? '')}
            style={{
              width: '100%',
              minHeight: 132,
              padding: 10,
              borderWidth: 1,
              borderColor: validationError?.field === 'value' ? C.warning : C.border,
              borderRadius: 6,
              backgroundColor: C.canvas,
              color: C.text,
              fontSize: 13,
              lineHeight: 20,
            }}
          />
          {validationError?.field === 'value' ? (
            <text testId="envvar-editor-validation-error" style={{ fontSize: 11, color: C.warning }}>
              {validationError.message}
            </text>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <DialogButton
            testId="envvar-editor-save"
            label={saving ? 'Saving EnvVar' : 'Save EnvVar'}
            text={saving ? 'Saving…' : 'Save'}
            variant="primary"
            disabled={saving}
            onClick={onSave}
          />
        </div>
      </div>
    </div>
  )
}
