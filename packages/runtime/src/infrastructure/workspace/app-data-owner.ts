import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Protect a resolved installation before any product database is opened. */
export async function ownAppData(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "runtime-owner.sqlite");
  const db = new Database(path, { strict: true });
  const token = crypto.randomUUID();
  try {
    await chmod(path, 0o600);
    db.exec(
      "PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL)",
    );
    db.transaction(() => {
      const owner = db
        .query<{ pid: number }, []>("SELECT pid FROM owner WHERE id=1")
        .get();
      if (owner && alive(owner.pid))
        throw new Error(
          `App data at ${directory} is already owned by a running runtime. Stop it before upgrading or choose a separate DATA_DIRECTORY. No product stores were opened.`,
        );
      db.query("INSERT OR REPLACE INTO owner VALUES(1,?,?)").run(
        process.pid,
        token,
      );
    })();
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    close() {
      try {
        db.query("DELETE FROM owner WHERE token=?").run(token);
      } finally {
        db.close();
      }
    },
  };
}
