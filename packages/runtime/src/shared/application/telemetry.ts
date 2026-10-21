export type TraceName =
  | "agent.run"
  | "model.generate"
  | "model.retry"
  | "runtime.start"
  | "http.request"
  | "session.submit"
  | "approval.decide"
  | "file.submit"
  | "file.decide"
  | "tool.call"
  | "delivery.send";

export type TraceAttributes = Partial<
  Record<
    | "model.provider"
    | "model.id"
    | "model.stop_reason"
    | "model.attempt"
    | "model.input_tokens"
    | "model.output_tokens"
    | "model.cache_read_tokens"
    | "model.cache_write_tokens"
    | "execution.outcome"
    | "execution.partial"
    | "session.id"
    | "turn.id"
    | "approval.id"
    | "delivery.id"
    | "tool.name"
    | "source"
    | "http.method"
    | "http.route"
    | "http.status_code",
    string | number | boolean
  >
>;

export interface TraceSpan {
  annotate(attributes: TraceAttributes): void;
  end(outcome?: "ok" | "error" | "interrupted"): void;
}

export interface Telemetry {
  start(
    name: TraceName,
    attributes: TraceAttributes,
    parent?: TraceSpan,
  ): TraceSpan;
  run<A>(
    name: TraceName,
    attributes: TraceAttributes,
    operation: (annotate: (attributes: TraceAttributes) => void) => Promise<A>,
  ): Promise<A>;
}

export const noTelemetry: Telemetry = {
  start: () => ({ annotate: () => {}, end: () => {} }),
  run: (_name, _attributes, operation) => operation(() => {}),
};
