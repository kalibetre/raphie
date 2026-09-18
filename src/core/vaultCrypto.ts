const encoder = new TextEncoder()
const decoder = new TextDecoder()

const algorithm = 'AES-GCM'
const keyLength = 32
const nonceLength = 12

const asArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

export const VAULT_FORMAT_VERSION = 1
export const VAULT_NONCE_LENGTH = nonceLength

export interface EncryptedVaultState {
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
}

const importKey = (keyBytes: Uint8Array) =>
  crypto.subtle.importKey('raw', asArrayBuffer(keyBytes), { name: algorithm }, false, ['encrypt', 'decrypt'])

export const generateVaultKey = () => crypto.getRandomValues(new Uint8Array(keyLength))

export const encryptVaultState = async (keyBytes: Uint8Array): Promise<EncryptedVaultState> => {
  const key = await importKey(keyBytes)
  const nonce = crypto.getRandomValues(new Uint8Array(nonceLength))
  const plaintext = encoder.encode(JSON.stringify({ formatVersion: VAULT_FORMAT_VERSION }))
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
  const state = JSON.parse(decoder.decode(plaintext)) as { readonly formatVersion?: unknown }

  if (state.formatVersion !== VAULT_FORMAT_VERSION) throw new Error('unsupported vault format')
}

export const isVaultKey = (value: Uint8Array) => value.byteLength === keyLength
