import { chmod, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { VaultLockState, VaultRecord, VaultStorage } from './vault.ts'

const databaseName = 'vault.sqlite'

const schema = `
  CREATE TABLE IF NOT EXISTS vault_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    format_version INTEGER NOT NULL,
    lock_state TEXT NOT NULL CHECK (lock_state IN ('locked', 'unlocked')),
    nonce BLOB NOT NULL,
    ciphertext BLOB NOT NULL
  )
`

interface VaultRow {
  readonly format_version: number
  readonly lock_state: string
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
}

export const vaultDatabasePath = (home: string) => join(home, databaseName)

const asBytes = (value: unknown) => {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  throw new Error('invalid vault binary field')
}

const asRecord = (row: VaultRow): VaultRecord => {
  if (row.lock_state !== 'locked' && row.lock_state !== 'unlocked') throw new Error('invalid vault lock state')

  return {
    formatVersion: row.format_version,
    lockState: row.lock_state,
    nonce: asBytes(row.nonce),
    ciphertext: asBytes(row.ciphertext),
  }
}

export const makeSqliteVaultStorage = (home: string): VaultStorage => ({
  read: async () => {
    const file = vaultDatabasePath(home)
    if (!existsSync(file)) return null

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      const row = database
        .prepare('SELECT format_version, lock_state, nonce, ciphertext FROM vault_state WHERE id = 1')
        .get() as unknown as VaultRow | undefined
      return row == null ? null : asRecord(row)
    } finally {
      database.close()
    }
  },

  create: async (record) => {
    await mkdir(home, { recursive: true, mode: 0o700 })
    const file = vaultDatabasePath(home)
    const database = new DatabaseSync(file)
    try {
      database.exec(schema)
      const existing = database.prepare('SELECT id FROM vault_state WHERE id = 1').get()
      if (existing != null) throw new Error('vault already exists')

      database.prepare(
        'INSERT INTO vault_state (id, format_version, lock_state, nonce, ciphertext) VALUES (1, ?, ?, ?, ?)',
      ).run(record.formatVersion, record.lockState, record.nonce, record.ciphertext)
    } finally {
      database.close()
    }
    await chmod(file, 0o600)
  },

  remove: async () => {
    const file = vaultDatabasePath(home)
    if (!existsSync(file)) return

    const database = new DatabaseSync(file)
    try {
      database.prepare('DELETE FROM vault_state WHERE id = 1').run()
    } finally {
      database.close()
    }
  },

  updateLockState: async (lockState: VaultLockState) => {
    const file = vaultDatabasePath(home)
    if (!existsSync(file)) throw new Error('vault does not exist')

    const database = new DatabaseSync(file)
    try {
      database.prepare('UPDATE vault_state SET lock_state = ? WHERE id = 1').run(lockState)
      const record = database.prepare('SELECT id FROM vault_state WHERE id = 1').get()
      if (record == null) throw new Error('vault does not exist')
    } finally {
      database.close()
    }
  },
})
