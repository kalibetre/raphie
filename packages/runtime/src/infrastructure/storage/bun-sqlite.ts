import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";

/** Pi owns schema/recovery. This driver owns one Bun connection and async isolation. */
export class BunSqliteDatabase implements SqliteDatabase {
  private readonly database: Database;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(path: string) {
    this.database = new Database(path, { strict: true });
    try {
      this.database.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 1000;",
      );
    } catch (error) {
      this.database.close(true);
      throw error;
    }
  }

  private queued<A>(operation: () => A | Promise<A>): Promise<A> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private executor(active: () => boolean): SqliteExecutor {
    const check = () => {
      if (this.closed) throw new Error("SQLite database is closed.");
      if (!active())
        throw new Error("SQLite transaction handle is no longer active.");
    };
    return {
      exec: async (sql) => {
        check();
        this.database.exec(sql);
      },
      run: async (sql, ...params) => {
        check();
        this.database.query(sql).run(...params);
      },
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        check();
        return (
          this.database.query<T, SqliteValue[]>(sql).get(...params) ?? undefined
        );
      },
      all: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        check();
        return this.database.query<T, SqliteValue[]>(sql).all(...params);
      },
    };
  }

  exec(sql: string) {
    return this.queued(() => this.executor(() => true).exec(sql));
  }

  run(sql: string, ...params: SqliteValue[]) {
    return this.queued(() => this.executor(() => true).run(sql, ...params));
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.queued(() => this.executor(() => true).get<T>(sql, ...params));
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.queued(() => this.executor(() => true).all<T>(sql, ...params));
  }

  transaction<A>(operation: (tx: SqliteExecutor) => Promise<A>) {
    return this.queued(async () => {
      if (this.closed) throw new Error("SQLite database is closed.");
      this.database.exec("BEGIN IMMEDIATE");
      let active = true;
      try {
        const value = await operation(this.executor(() => active));
        active = false;
        this.database.exec("COMMIT");
        return value;
      } catch (error) {
        active = false;
        try {
          this.database.exec("ROLLBACK");
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            "SQLite transaction and rollback failed.",
          );
        }
        throw error;
      }
    });
  }

  close() {
    return this.queued(() => {
      if (this.closed) return;
      this.closed = true;
      try {
        this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        this.database.close(true);
      }
    });
  }
}

export async function openBunSqliteStorage(path: string) {
  if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
  const database = new BunSqliteDatabase(path);
  try {
    return await SqliteStorage.open(database);
  } catch (error) {
    await database.close().catch(() => {});
    throw error;
  }
}
