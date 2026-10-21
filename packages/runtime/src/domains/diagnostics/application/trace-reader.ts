import type { TraceDiagnostics } from "@raphie/contracts";

/** Read-only telemetry inspection; no dependency on execution or recovery state. */
export interface TraceReader {
  read(hours: 1 | 6 | 24): Promise<TraceDiagnostics>;
}

export const noTraces: TraceReader = {
  async read(hours) {
    const to = Date.now();
    return {
      source: "otlp",
      state: "unconfigured",
      exportEnabled: false,
      spans: [],
      from: to - hours * 3600_000,
      to,
      spanLimit: 500,
    };
  },
};
