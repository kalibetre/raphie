const encoder = new TextEncoder()
const decoder = new TextDecoder()

const algorithm = 'AES-GCM'
const keyLength = 32
const nonceLength = 12
const saltLength = 16
const kdfIterations = 600_000

const asArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

export const VAULT_FORMAT_VERSION = 2
export const VAULT_NONCE_LENGTH = nonceLength
export const VAULT_SALT_LENGTH = saltLength
export const VAULT_PASSWORD_MIN_LENGTH = 8

export interface EncryptedVaultState {
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
}

const importKey = (keyBytes: Uint8Array) =>
  crypto.subtle.importKey('raw', asArrayBuffer(keyBytes), { name: algorithm }, false, ['encrypt', 'decrypt'])

export const generateVaultSalt = () => crypto.getRandomValues(new Uint8Array(saltLength))

export const deriveVaultKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey('raw', asArrayBuffer(encoder.encode(password)), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: kdfIterations,
      salt: asArrayBuffer(salt),
    },
    material,
    keyLength * 8,
  )
  return new Uint8Array(bits)
}

export const encryptVaultState = async (keyBytes: Uint8Array, state: unknown = {}): Promise<EncryptedVaultState> => {
  const key = await importKey(keyBytes)
  const nonce = crypto.getRandomValues(new Uint8Array(nonceLength))
  const plaintext = encoder.encode(JSON.stringify({ formatVersion: VAULT_FORMAT_VERSION, state }))
  const ciphertext = await crypto.subtle.encrypt(
    { name: algorithm, iv: asArrayBuffer(nonce) },
    key,
    asArrayBuffer(plaintext),
  )

  return { nonce, ciphertext: new Uint8Array(ciphertext) }
}

export const decryptVaultState = async (keyBytes: Uint8Array, encrypted: EncryptedVaultState) => {
  const key = await importKey(keyBytes)
  const plaintext = await crypto.subtle.decrypt(
    { name: algorithm, iv: asArrayBuffer(encrypted.nonce) },
    key,
    asArrayBuffer(encrypted.ciphertext),
  )
  const state = JSON.parse(decoder.decode(plaintext)) as {
    readonly formatVersion?: unknown
    readonly state?: unknown
  }

  if (state.formatVersion !== VAULT_FORMAT_VERSION) throw new Error('unsupported vault format')
  return state.state
}
