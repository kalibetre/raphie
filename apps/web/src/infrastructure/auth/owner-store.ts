import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fchmodSync, openSync } from "node:fs";

const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Persistent single-owner identity and opaque, revocable browser sessions. */
export class OwnerStore {
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
      CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    `);
  }

  configured(): boolean {
    return !!this.db.query("SELECT id FROM owner WHERE id = 1").get();
  }

  async changeOwner(
    currentPassword: string,
    username: string,
    password: string,
  ): Promise<boolean> {
    if (
      !username.trim() ||
      username.length > 128 ||
      password.length < 12 ||
      password.length > 1024
    )
      return false;
    const old = this.db
      .query("SELECT password_hash FROM owner WHERE id = 1")
      .get() as { password_hash: string } | null;
    if (
      !old ||
      !(await Bun.password.verify(currentPassword, old.password_hash))
    )
      return false;
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    return this.db.transaction(() => {
      const updated = this.db
        .query(
          "UPDATE owner SET username = ?, password_hash = ? WHERE id = 1 AND password_hash = ?",
        )
        .run(username.trim(), hash, old.password_hash);
      if (!updated.changes) return false;
      this.db.query("DELETE FROM sessions").run();
      return true;
    })();
  }

  async setOwner(
    username: string,
    password: string,
    createOnly = false,
  ): Promise<void> {
    if (
      !username.trim() ||
      username.length > 128 ||
      password.length < 12 ||
      password.length > 1024
    )
      throw new Error(
        "Enter a username and a password of at least 12 characters.",
      );
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    this.db.transaction(() => {
      if (createOnly && this.configured())
        throw new Error("Owner account already exists.");
      this.db
        .query(
          "INSERT INTO owner (id, username, password_hash) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash",
        )
        .run(username.trim(), hash);
      this.db.query("DELETE FROM sessions").run();
    })();
  }

  async signIn(
    username: string,
    password: string,
    now = Date.now(),
  ): Promise<string | null> {
    const owner = this.db
      .query("SELECT username, password_hash FROM owner WHERE id = 1")
      .get() as { username: string; password_hash: string } | null;
    if (
      !owner ||
      username !== owner.username ||
      !(await Bun.password.verify(password, owner.password_hash))
    )
      return null;
    const token = randomBytes(32).toString("base64url");
    return this.db.transaction(() => {
      const current = this.db
        .query("SELECT password_hash FROM owner WHERE id = 1")
        .get() as { password_hash: string } | null;
      if (current?.password_hash !== owner.password_hash) return null;
      this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      this.db
        .query("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)")
        .run(digest(token), now + sessionLifetime);
      return token;
    })();
  }

  valid(token: string, now = Date.now()): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return !!this.db
      .query("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(digest(token), now);
  }

  signOut(token: string): void {
    this.db
      .query("DELETE FROM sessions WHERE token_hash = ?")
      .run(digest(token));
  }

  close(): void {
    this.db.close();
  }
}
