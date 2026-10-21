import { Clock, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";
import type { Span } from "effect/Tracer";

import type {
  Telemetry,
  TraceAttributes,
  TraceName,
  TraceSpan,
} from "../../shared/application/telemetry.ts";
import { noTelemetry } from "../../shared/application/telemetry.ts";

/** OTLP is an optional observer, never the source of durable execution truth. */
export async function createTelemetry(
  options: {
    endpoint?: string;
    serviceName?: string;
    exportIntervalMs?: number;
    attemptId?: string;
  } = {},
): Promise<Telemetry & { close(): Promise<void> }> {
  if (!options.endpoint) return { ...noTelemetry, close: async () => {} };
  const url = new URL(options.endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "OTLP endpoint must be HTTP(S) without embedded credentials, query or fragment.",
    );
  const layer = OtlpTracer.layer({
    url: url.href,
    resource: {
      serviceName: options.serviceName ?? "raphie-runtime",
      serviceVersion: "0.1.0",
      attributes: {
        "raphie.runtime.attempt_id": options.attemptId ?? crypto.randomUUID(),
        "process.runtime.name": "bun",
        "process.runtime.version": Bun.version,
      },
    },
    exportInterval: options.exportIntervalMs ?? 1000,
    maxBatchSize: 256,
    shutdownTimeout: "2 seconds",
  }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(OtlpSerialization.layerJson),
  );
  const runtime = ManagedRuntime.make(layer);
  await runtime.runPromise(Effect.void);
  const parents = new WeakMap<TraceSpan, Span>();
  return {
    start(name, attributes, parent) {
      const span = runtime.runSync(
        Effect.makeSpan(name, {
          attributes,
          parent: parent ? parents.get(parent) : undefined,
        }),
      );
      let ended = false;
      const handle: TraceSpan = {
        annotate(values) {
          if (ended) return;
          for (const [key, value] of Object.entries(values))
            span.attribute(key, value);
        },
        end(outcome = "ok") {
          if (ended) return;
          ended = true;
          span.attribute("execution.outcome", outcome);
          span.end(
            runtime.runSync(Clock.currentTimeNanos),
            outcome === "ok"
              ? Exit.succeed(undefined)
              : Exit.fail({ _tag: "OperationFailed" }),
          );
        },
      };
      parents.set(handle, span);
      return handle;
    },
    async run<A>(
      name: TraceName,
      attributes: TraceAttributes,
      operation: (
        annotate: (attributes: TraceAttributes) => void,
      ) => Promise<A>,
    ) {
      let originalFailure: unknown;
      let failed = false;
      const effect = Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        return yield* Effect.tryPromise({
          try: () =>
            operation((values) => {
              for (const [key, value] of Object.entries(values))
                span.attribute(key, value);
            }),
          // A remote SDK error can contain headers, arguments or credentials.
          // Export only a fixed failure tag while returning the original error to its caller.
          catch: (error) => {
            failed = true;
            originalFailure = error;
            return { _tag: "OperationFailed" };
          },
        });
      }).pipe(Effect.withSpan(name, { attributes }));
      const exit = await runtime.runPromiseExit(effect);
      if (Exit.isSuccess(exit)) return exit.value;
      if (failed) throw originalFailure;
      throw new Error("Telemetry operation interrupted.");
    },
    close: () => runtime.dispose(),
  };
}
