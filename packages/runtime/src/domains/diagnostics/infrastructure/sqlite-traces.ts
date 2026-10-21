import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { DiagnosticSpan, TraceDiagnostics } from "@raphie/contracts";

import type { TraceReader } from "../application/trace-reader.ts";
import { decodeOtlpSpans } from "./otlp-spans.ts";

const retentionMs = 48 * 3600_000;
const spanLimit = 500;

/** Trace-only storage. This database never contains execution or approval state. */
export class SqliteTraces implements TraceReader {
  private closed = false;
  private readonly database: Database;
  private readonly serviceName: string;
  private readonly maxSpans: number;
  private readonly now: () => number;

  private constructor(
    database: Database,
    serviceName: string,
    maxSpans: number,
    now: () => number,
  ) {
    this.database = database;
    this.serviceName = serviceName;
    this.maxSpans = maxSpans;
    this.now = now;
  }

  static async open(
    path: string,
    options: {
      serviceName?: string;
      maxSpans?: number;
      now?: () => number;
    } = {},
  ) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const database = new Database(path, { strict: true });
    try {
      await chmod(path, 0o600);
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 1000;
        CREATE TABLE IF NOT EXISTS spans (
          trace_id TEXT NOT NULL, span_id TEXT NOT NULL,
          started_at INTEGER NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (trace_id, span_id)
        );
        CREATE INDEX IF NOT EXISTS spans_started ON spans(started_at DESC, trace_id, span_id);
      `);
      return new SqliteTraces(
        database,
        options.serviceName ?? "raphie-runtime",
        options.maxSpans ?? 100_000,
        options.now ?? Date.now,
      );
    } catch (error) {
      database.close(true);
      throw error;
    }
  }

  private prune(now: number) {
    this.database
      .query("DELETE FROM spans WHERE started_at < ?")
      .run(now - retentionMs);
    this.database
      .query(`DELETE FROM spans WHERE (trace_id, span_id) IN (
      SELECT trace_id, span_id FROM spans ORDER BY started_at DESC, trace_id, span_id LIMIT -1 OFFSET ?
    )`)
      .run(this.maxSpans);
  }

  ingest(payload: unknown) {
    if (this.closed) throw new Error("Trace storage closed");
    const spans = decodeOtlpSpans(payload, this.serviceName);
    const now = this.now();
    const insert = this.database.query(
      "INSERT OR IGNORE INTO spans(trace_id, span_id, started_at, payload) VALUES (?, ?, ?, ?)",
    );
    this.database.transaction(() => {
      for (const span of spans) {
        if (
          span.startedAt < now - retentionMs ||
          span.startedAt > now + 300_000
        )
          continue;
        insert.run(
          span.traceId,
          span.spanId,
          span.startedAt,
          JSON.stringify(span),
        );
      }
      this.prune(now);
    })();
  }

  async read(hours: 1 | 6 | 24): Promise<TraceDiagnostics> {
    const to = this.now();
    const result: TraceDiagnostics = {
      source: "otlp",
      state: "ready",
      exportEnabled: true,
      spans: [],
      from: to - hours * 3600_000,
      to,
      spanLimit,
    };
    try {
      if (this.closed) throw new Error("Trace storage closed");
      this.prune(to);
      result.spans = this.database
        .query<{ payload: string }, [number, number, number]>(
          "SELECT payload FROM spans WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC, trace_id, span_id LIMIT ?",
        )
        .all(result.from, to, spanLimit)
        .map((row) => JSON.parse(row.payload) as DiagnosticSpan);
      return result;
    } catch {
      return { ...result, state: "unavailable" };
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      this.database.close(true);
    }
  }
}
