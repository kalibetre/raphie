# Effect OTLP and Bun-native runtime

The runtime uses the installed Effect **4.0.5** OTLP exporter directly:
`effect/observability` (`OtlpTracer`, `OtlpSerialization`) and Effect's fetch HTTP
client. No OpenTelemetry dependency or external monitoring service was added.
The exporter is an unstable API pinned by the existing Effect version; don't use
Effect 3 `@effect/opentelemetry` setup examples unchanged with this project.

## Embedded OTLP storage

Normal runtime startup opens an in-process Hono OTLP/HTTP JSON receiver on an
OS-assigned loopback port. Effect exports directly to that receiver. It validates
and projects the incoming OTLP data before storing it in `traces.sqlite` under
`DATA_DIRECTORY` (normally `.data`). Storage uses `bun:sqlite`, WAL and a separate
schema; it never reads or modifies the execution database or activity journal.
There is no Jaeger, Docker requirement, cloud backend or extra process.

`OTEL_SERVICE_NAME` identifies the runtime's spans. No collector address, secret
or private configuration edit is needed. Normal startup now always enables local
tracing; the previous optional `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` setting is no
longer used by bootstrap. Direct `createTelemetry()` users such as tests can still
supply their own endpoint or omit it to disable export.

This is a deliberately limited receiver for Effect's OTLP JSON trace profile,
not a general OpenTelemetry collector: no protobuf, gRPC, compression, metrics,
logs, forwarding, public ingress or arbitrary service discovery. It accepts
`POST /v1/traces` with `application/json`, rejects browser Origins and foreign
Host headers, limits each body to 4 MiB / 1,000 distinct spans, and acknowledges
only after the sanitized batch commits. Resource service names must match.
Unknown attributes, events, links and raw status messages are discarded. IDs
use OTLP hexadecimal encoding. Invalid batches fail atomically; storage errors
return a generic 503 without private exception details.

Trace retention is **48 hours and at most 100,000 spans**, pruned on ingestion
and reads. Duplicate `(traceId, spanId)` exports are idempotent. Each approved
string attribute is capped at 512 characters. SQLite reuses freed pages; the
row/age cap does not promise an immediate shrink of an existing database file.
The file is mode 0600. Session/approval state remains in `gateway.sqlite`.

## Trace-only Diagnostics

`GET /api/diagnostics/traces?hours=1|6|24` returns at most the **latest 500 spans**,
newest first, with trace/span/parent IDs, timing, explicit status and selected
attributes. The same loopback Host/Origin checks as other local read routes apply.
The web page polls every five seconds while mounted, offers time-window and text
filters, expandable metadata and a trace-only JSON download. Unconfigured or
unavailable storage is explicit; there is **no activity-journal fallback**.
Diagnostics polling is excluded from tracing to avoid a self-observation loop.

The session Activity panel, model usage and recovery remain journal-based. Old
journal entries are not converted into traces: Diagnostics begins with newly
exported spans, and survives restarts only within the trace store's retention.

## Instrumented operations

| Span                         | Meaning                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `runtime.start`              | Open/migrate/recover the durable runtime                           |
| `http.request`               | HTTP handler through response headers, not the SSE viewer lifetime |
| `agent.run`                  | One Pi run, including model turns and tool/approval waits          |
| `model.generate`             | One observed generation attempt, from turn start through response  |
| `model.retry`                | Backoff between model attempts                                     |
| `session.submit`             | Durable message admission, not model completion                    |
| `approval.decide`            | Owner decision about an exact tool proposal                        |
| `file.submit`, `file.decide` | Retained file-copy experiment commands                             |
| `tool.call`                  | Actual remote MCP call, including allowed documentation lookups    |
| `delivery.send`              | One claimed platform send/edit attempt                             |

Exported attributes are explicitly selected operational metadata: public session,
turn, approval and delivery identifiers, tool name, source, HTTP method, matched
route template and status. Model spans also carry provider/model IDs, attempt number,
stop reason and input/output/cache token counts. The resource includes service/runtime versions and
the same runtime-attempt ID used by the activity journal when bootstrapped normally.
Raw URLs, headers, prompt text, tool arguments/results, message bodies, attachment
names and raw exception text are excluded. A failed operation exports only a
fixed failure tag and rethrows the original error to its caller.

Agent runs parent their model-attempt and retry spans. Other operational spans
are separately scoped and correlated by durable identifiers and runtime attempt.
Timings come from Pi live events, including time waiting for the first response;
they are not separate network-level provider request measurements. Spans are
exported when they finish, so active work appears after completion. Shutdown or
a replaced observation snapshot ends unfinished spans as interrupted; observations
attached to existing work are marked `execution.partial`. Historical timing is
never reconstructed. A process kill can lose unfinished spans; a recovered run
starts a new partial trace. There is no distributed `traceparent` propagation,
token/queue metrics or log export yet.
Effect supports further telemetry, but exporting arbitrary existing logs or raw
model payloads would bypass the deliberate field selection above.

## Ownership and failure behavior

The process scope owns the managed Effect tracing runtime. It opens after the local collector and before the
agent/HTTP/channel resources. Shutdown closes agents and HTTP first, then flushes
Effect, then stops the collector and checkpoints its trace database. Export
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

The complete gate checks tests, formatting, type-aware lint, architecture
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
or VM were changed. That earlier rollout left OTLP export disabled; embedded storage now replaces
that configuration-dependent setup.

See [the Bun audit](bun-migration.md) for which tooling was adopted and which
compatibility APIs remain deliberately. Linux deployment/capacity testing is still
a separate step; this audit doesn't establish 100-agent/sandbox capacity.

Embedded storage tests additionally exercise real Effect export through HTTP into
SQLite and then Diagnostics, with the journal inspection method replaced by a
throwing sentinel. They cover retry deduplication, persisted reopen, age/count
retention, field projection, permissions, invalid/oversized batches, content-type
and Origin rejection, missing storage and closed storage states.

The embedded runtime and web build were started locally on 2026-10-21 after an
online backup at `.data/backups/before-embedded-otlp-20261021.sqlite` (mode 0600).
The 1 session, 7 turns and 7 approval IDs, outcomes and deadlines were unchanged.
Both SQLite integrity checks returned `ok`. The web proxy returned actual
`runtime.start` and `http.request` spans with `source: "otlp"` and `state: "ready"`.
Browser checks at 390px and 1440px found no horizontal document overflow; text
filtering, expanded metadata and 24-hour window queries worked. Diagnostics made
no `/api/inspection/activity` requests. Screenshot capture timed out twice, so
these are DOM/interaction checks rather than a completed screenshot review.
The exploratory Jaeger container and its temporary volume were removed; the
implementation requires neither. No VM or private configuration was changed.

### Agent execution tracing follow-up

The generation loop now exports `agent.run`, child `model.generate` attempts and
retry backoff spans. The full validation gate passes 58 tests, including a real
Pi tool cycle with two model spans under the same run, failed model metadata
persisted through Effect/OTLP/SQLite, redaction, and retry/shutdown lifecycle checks.
No paid model calls were used. After a graceful local restart, the running web
proxy served ready Diagnostics and the existing session, seven turn IDs/statuses
and seven approval IDs/statuses/deadlines matched the pre-restart metadata.
