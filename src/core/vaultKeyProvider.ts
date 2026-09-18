import { createHash } from 'node:crypto'
import type { VaultKeyProvider } from './vault.ts'

const service = 'com.raphie.vault'

const encode = (key: Uint8Array) => Buffer.from(key).toString('base64')
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))

const keyNameFor = (vaultIdentity: string) =>
  `vault-${createHash('sha256').update(vaultIdentity).digest('hex')}`

const getSecrets = () => {
  if (typeof Bun === 'undefined') throw new Error('Bun OS secret storage is unavailable')
  return Bun.secrets
}

export const makeBunSecretVaultKeyProvider = (vaultIdentity = 'default'): VaultKeyProvider => {
  const name = keyNameFor(vaultIdentity)

  return {
    read: async () => {
      const value = await getSecrets().get({ service, name })
      return value === null ? null : decode(value)
    },
    write: (key) => getSecrets().set({ service, name, value: encode(key) }),
  }
}
