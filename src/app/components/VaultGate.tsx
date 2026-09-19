import type { EventPayload } from '@gpuix/react'
import { useState } from 'react'
import { C } from '../theme.ts'
import { DialogButton } from './DialogButton.tsx'

export type VaultGateStatus = 'loading' | 'uninitialized' | 'locked' | 'unavailable'

// Monospace so the real (transparent) glyphs are as wide as the bullets drawn over them;
// otherwise the native caret drifts right of the mask as you type.
const MASK_FONT = 'Menlo'

function SecretInput({
  testId,
  value,
  placeholder,
  autoFocus,
  onChange,
}: {
  testId: string
  value: string
  placeholder: string
  autoFocus?: boolean
  onChange: (event: EventPayload) => void
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 34,
      }}
    >
      <input
        testId={testId}
        value={value}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onChange={onChange}
        style={{
          width: '100%',
          minHeight: 34,
          paddingLeft: 10,
          paddingRight: 10,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 6,
          backgroundColor: C.canvas,
          color: 'transparent',
          fontSize: 13,
          fontFamily: MASK_FONT,
        }}
        theme={{ caret: C.text }}
      />
      <text
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          right: 10,
          color: value.length === 0 ? C.ghost : C.text,
          fontSize: 13,
          fontFamily: value.length === 0 ? undefined : MASK_FONT,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {value.length === 0 ? placeholder : '•'.repeat(value.length)}
      </text>
    </div>
  )
}

export function VaultGate({
  status,
  busy,
  error,
  onCreate,
  onUnlock,
  onRetry,
}: {
  status: VaultGateStatus
  busy: boolean
  error: string | null
  onCreate: (password: string) => void
  onUnlock: (password: string) => void
  onRetry: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const creating = status === 'uninitialized'
  const title = status === 'loading' ? 'Opening your Vault' : creating ? 'Create your Vault' : status === 'locked' ? 'Unlock your Vault' : 'Vault unavailable'
  const description = status === 'loading'
    ? 'Checking the local encrypted Vault…'
    : creating
    ? 'Choose a password to encrypt Projects, Profiles, and EnvVars in your local Vault.'
    : status === 'locked'
      ? 'Enter your Vault password to access your encrypted Projects and Profiles.'
      : 'Raphie could not access the local Vault. Check the application data directory and try again.'

  const submit = () => {
    if (busy || status === 'unavailable') return
    if (password.length < 8) {
      setFormError('Use at least 8 characters.')
      return
    }
    if (creating && password !== confirmation) {
      setFormError('The passwords do not match.')
      return
    }
    setFormError(null)
    if (creating) onCreate(password)
    else onUnlock(password)
    setPassword('')
    setConfirmation('')
  }

  return (
    <div
      testId="vault-gate"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.canvas,
      }}
    >
      <div
        testId="vault-gate-card"
        style={{
          width: 420,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 10,
          backgroundColor: C.raised,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 20, color: C.text }}>{title}</text>
          <text style={{ fontSize: 12, lineHeight: 18, color: C.secondary }}>{description}</text>
        </div>

        {status === 'loading' ? (
          <text style={{ fontSize: 11, color: C.secondary }}>Please wait…</text>
        ) : status !== 'unavailable' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <text style={{ fontSize: 11, color: C.secondary }}>Password</text>
              <SecretInput
                testId="vault-password"
                value={password}
                autoFocus
                placeholder="Vault password"
                onChange={(event) => {
                  setPassword(event.value ?? '')
                  setFormError(null)
                }}
              />
            </div>
            {creating ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <text style={{ fontSize: 11, color: C.secondary }}>Confirm password</text>
                <SecretInput
                  testId="vault-password-confirmation"
                  value={confirmation}
                  placeholder="Repeat your password"
                  onChange={(event) => {
                    setConfirmation(event.value ?? '')
                    setFormError(null)
                  }}
                />
              </div>
            ) : null}
            <text style={{ fontSize: 11, lineHeight: 16, color: C.ghost }}>
              Your password is not stored. If you lose it, encrypted values cannot be recovered without an export backup.
            </text>
            {formError || error ? (
              <text testId="vault-gate-error" style={{ fontSize: 11, color: C.warning }}>
                {formError ?? error}
              </text>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
              <DialogButton
                testId="vault-gate-submit"
                label={creating ? 'Create Vault' : 'Unlock Vault'}
                text={busy ? (creating ? 'Creating…' : 'Unlocking…') : creating ? 'Create Vault' : 'Unlock'}
                variant="primary"
                disabled={busy}
                onClick={submit}
              />
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <text style={{ fontSize: 11, color: C.warning }}>No encrypted values were loaded.</text>
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
              <DialogButton
                testId="vault-gate-retry"
                label="Retry opening Vault"
                text="Retry"
                variant="secondary"
                disabled={busy}
                onClick={onRetry}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
