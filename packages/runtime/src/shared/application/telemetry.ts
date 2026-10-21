export type TraceName =
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

export interface Telemetry {
  run<A>(
    name: TraceName,
    attributes: TraceAttributes,
    operation: (annotate: (attributes: TraceAttributes) => void) => Promise<A>,
  ): Promise<A>;
}

export const noTelemetry: Telemetry = {
  run: (_name, _attributes, operation) => operation(() => {}),
};
