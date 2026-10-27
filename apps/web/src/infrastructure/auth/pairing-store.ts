import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fchmodSync, openSync } from "node:fs";

const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Storage foundation only: it is not yet exposed by any HTTP or CLI route. */
export class PairingStore {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      const fd = openSync(path, "a", 0o600);
      try {
        fchmodSync(fd, 0o600);
      } finally {
        closeSync(fd);
      }
    }
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS pairing_codes (
        secret_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paired_devices (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        credential_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
    `);
  }

  createCode(now = Date.now(), lifetimeMs = 5 * 60_000) {
    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(lifetimeMs) ||
      lifetimeMs < 1 ||
      lifetimeMs > 10 * 60_000
    )
      throw new Error("Invalid pairing lifetime.");
    const secret = randomBytes(32).toString("base64url");
    this.db.transaction(() => {
      this.db.query("DELETE FROM pairing_codes WHERE expires_at <= ?").run(now);
      this.db
        .query("INSERT INTO pairing_codes VALUES (?, ?)")
        .run(hash(secret), now + lifetimeMs);
    })();
    return { secret, expiresAt: now + lifetimeMs };
  }

  cancelCode(secret: string) {
    if (tokenPattern.test(secret))
      this.db
        .query("DELETE FROM pairing_codes WHERE secret_hash = ?")
        .run(hash(secret));
  }

  redeem(secret: string, label: string, now = Date.now()) {
    if (
      !tokenPattern.test(secret) ||
      !label.trim() ||
      label.length > 80 ||
      !Number.isSafeInteger(now)
    )
      return null;
    const credential = randomBytes(32).toString("base64url");
    const id = crypto.randomUUID();
    return this.db.transaction(() => {
      const consumed = this.db
        .query(
          "DELETE FROM pairing_codes WHERE secret_hash = ? AND expires_at > ?",
        )
        .run(hash(secret), now);
      if (!consumed.changes) return null;
      this.db
        .query("INSERT INTO paired_devices VALUES (?, ?, ?, ?, ?, NULL)")
        .run(id, label.trim(), hash(credential), now, now);
      return { id, credential };
    })();
  }

  valid(credential: string, now = Date.now()) {
    if (!tokenPattern.test(credential) || !Number.isSafeInteger(now))
      return false;
    const result = this.db
      .query(
        "UPDATE paired_devices SET last_used_at = MAX(last_used_at, ?) WHERE credential_hash = ? AND revoked_at IS NULL",
      )
      .run(now, hash(credential));
    return result.changes === 1;
  }

  revoke(id: string, now = Date.now()) {
    return (
      this.db
        .query(
          "UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .run(now, id).changes === 1
    );
  }

  list() {
    return this.db
      .query<
        {
          id: string;
          label: string;
          created_at: number;
          last_used_at: number;
          revoked_at: number | null;
        },
        []
      >(
        "SELECT id, label, created_at, last_used_at, revoked_at FROM paired_devices ORDER BY created_at DESC",
      )
      .all();
  }

  close() {
    this.db.close();
  }
}
