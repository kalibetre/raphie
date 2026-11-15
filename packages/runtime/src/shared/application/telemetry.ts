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
    | "bot.id"
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

/**
 * One trace store serves every bot, so each bot's spans carry its id. A span
 * that names a bot itself keeps that one: the shared HTTP server records a
 * request under the bot its route addresses.
 */
export function botTelemetry(telemetry: Telemetry, botId: string): Telemetry {
  return {
    start: (name, attributes, parent) =>
      telemetry.start(name, { "bot.id": botId, ...attributes }, parent),
    run: (name, attributes, operation) =>
      telemetry.run(name, { "bot.id": botId, ...attributes }, operation),
  };
}
