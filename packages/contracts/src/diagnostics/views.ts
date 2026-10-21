/** Diagnostics contains exported traces only, never durable activity events. */
export type DiagnosticSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: number;
  durationMs: number;
  status: "unset" | "ok" | "error";
  attributes: Record<string, string | number | boolean>;
};

export type TraceDiagnostics = {
  source: "otlp";
  state: "ready" | "unconfigured" | "unavailable";
  exportEnabled: boolean;
  spans: DiagnosticSpan[];
  from: number;
  to: number;
  /** Query is bounded; this is not a complete execution history. */
  spanLimit: number;
};
