# Effect OTLP and Bun-native runtime

The runtime uses the installed Effect **4.0.5** OTLP exporter directly:
`effect/observability` (`OtlpTracer`, `OtlpSerialization`) and Effect's fetch HTTP
client. No OpenTelemetry dependency or external monitoring service was added.
The exporter is an unstable API pinned by the existing Effect version; don't use
Effect 3 `@effect/opentelemetry` setup examples unchanged with this project.

## Enable a self-hosted collector

Set these non-secret values in private local configuration, then restart the runtime:

```dotenv
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
OTEL_SERVICE_NAME=raphie-runtime
```

The URL is an example for your own collector, not a bundled collector process.
An empty endpoint disables export. Use a self-hosted OTLP/HTTP receiver; there
is no cloud fallback. Embedded URL credentials, queries and fragments are
rejected. The schema is validated by Varlock; no private configuration was
edited by this implementation. A metrics backend/dashboard deployment can follow
once the desired self-hosted collector is available.

## Instrumented operations

| Span                         | Meaning                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `runtime.start`              | Open/migrate/recover the durable runtime                           |
| `http.request`               | HTTP handler through response headers, not the SSE viewer lifetime |
| `session.submit`             | Durable message admission, not model completion                    |
| `approval.decide`            | Owner decision about an exact tool proposal                        |
| `file.submit`, `file.decide` | Retained file-copy experiment commands                             |
| `tool.call`                  | Actual remote MCP call, including allowed documentation lookups    |
| `delivery.send`              | One claimed platform send/edit attempt                             |

Exported attributes are explicitly selected operational metadata: public session,
turn, approval and delivery identifiers, tool name, source, HTTP method, matched
route template and status. The resource includes service/runtime versions and
the same runtime-attempt ID used by the activity journal when bootstrapped normally.
Raw URLs, headers, prompt text, tool arguments/results, message bodies, attachment
names and raw exception text are excluded. A failed operation exports only a
fixed failure tag and rethrows the original error to its caller.

These are separately scoped operational spans, correlated by durable identifiers
and runtime attempt; they are not a persisted parent/child trace spanning a process
restart. There is no distributed `traceparent` propagation yet. Model-provider
request spans, token/queue metrics and log export are not enabled by this slice.
Effect supports further telemetry, but exporting arbitrary existing logs or raw
model payloads would bypass the deliberate field selection above.

## Ownership and failure behavior

The process scope owns the managed Effect tracing runtime. It opens before the
agent/HTTP/channel resources and closes after them, flushing ended spans. Export
batches are bounded at 256 spans, normally flushed every second, with a two-second
shutdown timeout. The exporter handles transport retry/backoff; this never retries
an application command, remote tool effect or platform delivery.

A collector outage cannot turn a completed application operation into a failed one
or repeat it. Export is best-effort, not durable: an outage or process kill can
lose spans. Unknown action/delivery outcomes retain their existing uncertain
state regardless of exporter availability.

The durable activity journal remains the product's recovery/inspection record.
It retains execution history and approval outcomes across restarts; telemetry
provides operational timings and cross-module correlation. Neither exposes private
model reasoning. Tracing does not replace Pi's scheduler, journal or effect claims.

## Verification

The complete gate passes **54 tests**, formatting, type-aware lint, architecture
checks, TypeScript 7 and production build. OTLP tests use a local Bun HTTP collector
and exercise real HTTP admission, an approved model-proposed MCP call, decision
spans, uncertain delivery, error redaction and scope flushing. Another test stops
the collector: application work executes once and returns successfully, and exporter
shutdown remains bounded. No paid inference or external telemetry traffic is used.

Bun-native SQLite tests cover awaited transaction isolation, rollback and rollback
failure, invalidated transaction handles, queued close, binary round trips, and
reopening the same schema with the official Node driver. Existing admission,
approval, uncertain-action and SIGKILL recovery suites run against `bun:sqlite`.
A copy of the idle local database opened successfully with the native driver and
preserved its 1 session, 7 turns and 7 approval identities/statuses/deadlines.

The local runtime was then gracefully restarted on 2026-10-21 using its existing
private configuration. The same metadata comparison passed against the running
service: 1 session, 7 turns and 7 approvals, with no pending work. SQLite integrity
returned `ok`, and the web session proxy returned HTTP 200. The online backup is
`.data/backups/before-bun-native-20261021.sqlite` (mode 0600). No private settings
or VM were changed. OTLP export remains disabled because no collector endpoint
has been configured.

See [the Bun audit](bun-migration.md) for which tooling was adopted and which
compatibility APIs remain deliberately. Linux deployment/capacity testing is still
a separate step; this audit doesn't establish 100-agent/sandbox capacity.
