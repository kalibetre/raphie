import type { DiagnosticSpan } from "@raphie/contracts";
import { z } from "zod";

import { InputError } from "../../../shared/application/input-error.ts";

const attribute = z.object({
  key: z.string(),
  value: z.object({
    stringValue: z.string().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
    boolValue: z.boolean().optional(),
  }),
});
const attributes = z.array(attribute).default([]);
const id = (bytes: number) =>
  z.string().transform((value, ctx) => {
    if (new RegExp(`^[a-fA-F0-9]{${bytes * 2}}$`).test(value))
      return value.toLowerCase();
    ctx.addIssue({ code: "custom", message: "Invalid trace identifier" });
    return z.NEVER;
  });
const nanos = z.string().regex(/^\d{1,20}$/);
const payload = z.object({
  resourceSpans: z
    .array(
      z.object({
        resource: z.object({ attributes }).default({ attributes: [] }),
        scopeSpans: z
          .array(
            z.object({
              spans: z
                .array(
                  z.object({
                    traceId: id(16),
                    spanId: id(8),
                    parentSpanId: z.union([z.literal(""), id(8)]).optional(),
                    name: z.string().max(256),
                    startTimeUnixNano: nanos,
                    endTimeUnixNano: nanos,
                    attributes,
                    status: z
                      .object({
                        code: z
                          .union([
                            z.number().int().min(0).max(2),
                            z.enum([
                              "STATUS_CODE_UNSET",
                              "STATUS_CODE_OK",
                              "STATUS_CODE_ERROR",
                            ]),
                          ])
                          .optional(),
                      })
                      .optional(),
                  }),
                )
                .default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const allowed = new Set([
  "session.id",
  "turn.id",
  "approval.id",
  "delivery.id",
  "tool.name",
  "source",
  "http.method",
  "http.route",
  "http.status_code",
  "raphie.runtime.attempt_id",
  "service.name",
  "service.version",
  "process.runtime.name",
  "process.runtime.version",
]);

function safeAttributes(values: z.infer<typeof attributes>) {
  const entries: [string, string | number | boolean][] = [];
  for (const { key, value } of values) {
    if (!allowed.has(key)) continue;
    const scalar =
      value.stringValue ??
      value.intValue ??
      value.doubleValue ??
      value.boolValue;
    if (scalar !== undefined)
      entries.push([
        key,
        typeof scalar === "string" ? scalar.slice(0, 512) : scalar,
      ]);
  }
  return Object.fromEntries(entries);
}

/** Accept the OTLP/HTTP JSON profile emitted by Effect, not protobuf or gRPC. */
export function decodeOtlpSpans(
  body: unknown,
  serviceName: string,
): DiagnosticSpan[] {
  const spans = new Map<string, DiagnosticSpan>();
  const data = payload.parse(body);
  for (const resource of data.resourceSpans) {
    const metadata = safeAttributes(resource.resource.attributes);
    if (metadata["service.name"] !== serviceName) continue;
    for (const scope of resource.scopeSpans)
      for (const span of scope.spans) {
        const start = BigInt(span.startTimeUnixNano);
        const end = BigInt(span.endTimeUnixNano);
        if (end < start || start / 1_000_000n > 8_640_000_000_000_000n)
          throw new InputError("Invalid span interval");
        const code = span.status?.code;
        spans.set(`${span.traceId}:${span.spanId}`, {
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || null,
          name: span.name,
          startedAt: Number(start / 1_000_000n),
          durationMs: Number(end - start) / 1_000_000,
          status:
            code === 2 || code === "STATUS_CODE_ERROR"
              ? "error"
              : code === 1 || code === "STATUS_CODE_OK"
                ? "ok"
                : "unset",
          attributes: { ...metadata, ...safeAttributes(span.attributes) },
        });
        if (spans.size > 1000)
          throw new InputError("Trace request exceeds span limit");
      }
  }
  return [...spans.values()].sort(
    (a, b) => b.startedAt - a.startedAt || a.spanId.localeCompare(b.spanId),
  );
}
