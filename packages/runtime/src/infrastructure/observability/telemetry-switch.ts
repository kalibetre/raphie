import {
  noTelemetry,
  type Telemetry,
} from "../../shared/application/telemetry.ts";

/** Existing spans may finish flushing; disabled tracing never starts new work. */
export function switchableTelemetry(
  telemetry: Telemetry,
  enabled: () => boolean,
): Telemetry {
  return {
    start: (...args) => (enabled() ? telemetry : noTelemetry).start(...args),
    run: (name, attributes, operation) =>
      (enabled() ? telemetry : noTelemetry).run(name, attributes, operation),
  };
}
