import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { noTraces } from "../src/domains/diagnostics/application/trace-reader.ts";
import { openLocalOtlp } from "../src/domains/diagnostics/infrastructure/local-otlp.ts";
import { SqliteTraces } from "../src/domains/diagnostics/infrastructure/sqlite-traces.ts";
import { createTelemetry } from "../src/infrastructure/observability/effect-telemetry.ts";

function payload(now: number, count = 1) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "raphie-runtime" } },
          ],
        },
        scopeSpans: [
          {
            spans: Array.from({ length: count }, (_, n) => ({
              traceId: "0123456789abcdef0123456789abcdef",
              spanId: (n + 1).toString(16).padStart(16, "0"),
              name: "tool.call",
              startTimeUnixNano: String(BigInt(now - n) * 1_000_000n),
              endTimeUnixNano: String(
                BigInt(now - n) * 1_000_000n + 123456789n,
              ),
              status: { code: 2, message: "PRIVATE_ERROR" },
              attributes: [
                { key: "session.id", value: { stringValue: "session-1" } },
                { key: "prompt", value: { stringValue: "PRIVATE_PROMPT" } },
              ],
              events: [{ name: "PRIVATE_EVENT" }],
            })),
          },
        ],
      },
    ],
  };
}

test("OTLP SQLite storage deduplicates retries, strips private fields, bounds retention and survives reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-traces-"));
  const path = join(directory, "traces.sqlite");
  let now = Date.now();
  let traces = await SqliteTraces.open(path, { maxSpans: 2, now: () => now });
  try {
    traces.ingest(payload(now, 3));
    traces.ingest(payload(now, 3));
    let result = await traces.read(1);
    assert.equal(result.source, "otlp");
    assert.equal(result.spans.length, 2);
    assert.equal(result.spans[0]!.durationMs, 123.456789);
    assert.equal(result.spans[0]!.status, "error");
    assert.equal(result.spans[0]!.attributes["session.id"], "session-1");
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    traces.close();
    traces = await SqliteTraces.open(path, { maxSpans: 2, now: () => now });
    assert.deepEqual((await traces.read(1)).spans, result.spans);
    now += 49 * 3600_000;
    result = await traces.read(24);
    assert.deepEqual(result.spans, []);
    traces.ingest(payload(now));
    assert.equal((await traces.read(1)).spans.length, 1);
    assert.throws(() => traces.ingest(payload(now, 1001)));
    traces.close();
    assert.equal((await traces.read(1)).state, "unavailable");
  } finally {
    traces.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("real Effect export reaches local OTLP and Diagnostics without querying the execution journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-local-otlp-"));
  const collector = await openLocalOtlp(join(directory, "traces.sqlite"));
  const telemetry = await createTelemetry({
    endpoint: collector.endpoint,
    exportIntervalMs: 60_000,
  });
  const app = await Gateway.open({ directory, telemetry });
  const http = await startServer(app, {
    port: 0,
    diagnostics: collector.traces,
  });
  try {
    assert.equal((await noTraces.read(1)).state, "unconfigured");
    await telemetry.run(
      "tool.call",
      { "tool.name": "fixture" },
      async () => "PRIVATE_RESULT",
    );
    await telemetry.close();
    app.queries.activity = async () => {
      throw new Error("Journal must not be consulted");
    };
    const response = await fetch(`${http.url}/api/diagnostics/traces`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, "ready");
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0].name, "tool.call");
    assert.equal(JSON.stringify(result).includes("PRIVATE_RESULT"), false);
    assert.equal(
      (await fetch(`${http.url}/api/diagnostics/traces?hours=2`)).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${http.url}/api/diagnostics/traces`, {
          headers: { origin: "https://foreign.example" },
        })
      ).status,
      403,
    );
    for (const [headers, expected] of [
      [{ "content-type": "application/json", origin: "http://localhost" }, 403],
      [{ "content-type": "application/x-protobuf" }, 415],
      [{ "content-type": "application/json" }, 200],
    ] as const)
      assert.equal(
        (
          await fetch(collector.endpoint, {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
        expected,
      );
    assert.equal(
      (
        await fetch(collector.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(collector.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload(Date.now(), 1001)),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(collector.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "x".repeat(4 * 1024 * 1024 + 1),
        })
      ).status,
      413,
    );
    collector.traces.close();
    const unavailable = await fetch(`${http.url}/api/diagnostics/traces`);
    assert.equal((await unavailable.json()).state, "unavailable");
    const failedWrite = await fetch(collector.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(failedWrite.status, 503);
    assert.equal(
      (await failedWrite.text()).includes("Trace storage closed"),
      false,
    );
  } finally {
    await http.close();
    await app.close();
    await telemetry.close();
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  }
});
