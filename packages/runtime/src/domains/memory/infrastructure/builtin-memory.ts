import type { Database } from "bun:sqlite";

import type { MemoryEvidence } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { MemoryBackend, RetainMemory } from "../application/ports.ts";

/** Evidence is authoritative; no cached synthesis survives a correction or deletion. */
export class BuiltinMemory implements MemoryBackend {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS memory_receipts (scope TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS memory_evidence (
      scope TEXT NOT NULL, id TEXT NOT NULL, content TEXT NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, eventTime INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(scope,id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(
      scope UNINDEXED, id UNINDEXED, content, tokenize='unicode61'
    );`);
  }

  async retain(scope: string, input: RetainMemory) {
    this.db.transaction(() => {
      // Replay never resurrects a forgotten source or overwrites a correction.
      const previous = this.db
        .query<{ id: string }, [string, string]>(
          "SELECT id FROM memory_receipts WHERE scope=? AND id=?",
        )
        .get(scope, input.id);
      if (previous) return;
      this.db
        .query("INSERT INTO memory_receipts(scope,id) VALUES (?,?)")
        .run(scope, input.id);
      this.db
        .query(
          "INSERT INTO memory_evidence(scope,id,content,kind,source,eventTime) VALUES (?,?,?,?,?,?)",
        )
        .run(
          scope,
          input.id,
          input.content,
          input.kind,
          input.source,
          input.eventTime,
        );
      this.db
        .query("INSERT INTO memory_search(scope,id,content) VALUES (?,?,?)")
        .run(scope, input.id, input.content);
    })();
  }

  async recall(scope: string, query: string) {
    const terms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])].slice(
      0,
      24,
    );
    if (!terms.length) return { evidence: [] };
    const expression = terms.map((term) => `"${term}"`).join(" OR ");
    const rows = this.db
      .query<MemoryEvidence, [string, string]>(`
      SELECT e.id,e.content,e.kind,e.source,e.eventTime,e.revision
      FROM memory_search JOIN memory_evidence e
        ON e.scope=memory_search.scope AND e.id=memory_search.id
      WHERE memory_search MATCH ? AND e.scope=? ORDER BY rank LIMIT 8
    `)
      .all(expression, scope);
    return { evidence: rows };
  }

  async revise(scope: string, id: string, content: string) {
    this.db.transaction(() => {
      const changed = this.db
        .query(
          "UPDATE memory_evidence SET content=?,revision=revision+1 WHERE scope=? AND id=?",
        )
        .run(content, scope, id);
      if (!changed.changes)
        throw new InputError("Memory not found in this scope.", 404);
      this.db
        .query("DELETE FROM memory_search WHERE scope=? AND id=?")
        .run(scope, id);
      this.db
        .query("INSERT INTO memory_search(scope,id,content) VALUES (?,?,?)")
        .run(scope, id, content);
    })();
  }

  async forget(scope: string, id: string) {
    this.db.transaction(() => {
      this.db
        .query("DELETE FROM memory_search WHERE scope=? AND id=?")
        .run(scope, id);
      this.db
        .query("DELETE FROM memory_evidence WHERE scope=? AND id=?")
        .run(scope, id);
    })();
  }

  async test() {
    this.db.query("SELECT 1").get();
  }
}
