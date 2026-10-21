import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { createDeliveryWorker } from "../src/domains/delivery/application/worker.ts";
import { openLocalOtlp } from "../src/domains/diagnostics/infrastructure/local-otlp.ts";
import { createTelemetry } from "../src/infrastructure/observability/effect-telemetry.ts";
import { chatModel } from "./chat-model.ts";

test("Effect OTLP exports safe HTTP/command spans and flushes on close without exporting private payloads", async () => {
  const received: string[] = [];
  const collector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, "/v1/traces");
      received.push(await request.text());
      return Response.json({});
    },
  });
  const telemetry = await createTelemetry({
    endpoint: `http://127.0.0.1:${collector.port}/v1/traces`,
    exportIntervalMs: 60_000,
  });
  const directory = await mkdtemp(join(tmpdir(), "raphie-telemetry-"));
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: {
        name: "mcp_fixture_execute",
        args: { code: "PRIVATE_TOOL_ARGUMENTS" },
      },
    }),
    telemetry,
    mcp: {
      identity: "fixture",
      client: {
        server: { name: "fixture", version: "1" },
        tools: [
          {
            name: "execute",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
            },
          },
        ],
        call: async () => ({
          content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }],
        }),
        close: async () => {},
      },
    },
  });
  const http = await startServer(app, { port: 0 });
  const privateText = "PRIVATE PROMPT DO NOT EXPORT";
  const original = new Error("Authorization: Bearer PRIVATE_CREDENTIAL");
  try {
    const response = await fetch(`${http.url}/api/sessions/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-raphie-client": "web" },
      body: JSON.stringify({ eventId: "traced", text: privateText }),
    });
    assert.equal(response.status, 201);
    const receipt = (await response.json()) as {
      id: string;
      sessionId: string;
    };
    for (
      let n = 0;
      n < 100 && !(await app.toolApprovals.state()).approvals.length;
      n++
    )
      await delay(10);
    const proposal = (await app.toolApprovals.state()).approvals[0]!;
    await app.sessions.decide(
      app.actors.establish("web"),
      proposal.id,
      "approved",
    );
    for (
      let n = 0;
      n < 100 && (await app.chats.state()).turns[0]?.status === "pending";
      n++
    )
      await delay(10);
    assert.equal((await app.chats.state()).turns[0]!.status, "done");
    let claimed = false;
    let uncertain = false;
    await createDeliveryWorker(
      {
        claim: async () => {
          if (claimed) return null;
          claimed = true;
          return {
            id: "fixture-delivery",
            payload: "PRIVATE_DELIVERY_BODY",
            status: "sending",
            messageId: null,
          };
        },
        settle: async (_id, messageId) => {
          uncertain = messageId === null;
        },
      },
      async () => [],
      async () => {
        throw original;
      },
      telemetry,
    )();
    assert.equal(uncertain, true);
    await assert.rejects(
      telemetry.run("tool.call", { "tool.name": "fixture" }, async () => {
        throw original;
      }),
      (error) => error === original,
    );
    await http.close();
    await app.close();
    await telemetry.close();
    assert.ok(received.length, "Final scope disposal must flush batched spans");
    const wire = received.join("\n");
    assert.equal(wire.includes(privateText), false);
    for (const secret of [
      "PRIVATE_CREDENTIAL",
      "PRIVATE_TOOL_ARGUMENTS",
      "PRIVATE_TOOL_RESULT",
      "PRIVATE_DELIVERY_BODY",
    ])
      assert.equal(wire.includes(secret), false);
    assert.match(wire, /delivery.send/);
    assert.match(wire, new RegExp(receipt.sessionId));
    assert.match(wire, /session.submit/);
    assert.match(wire, /http.request/);
    assert.match(wire, /tool.call/);
    assert.match(wire, /OperationFailed/);
    const spans = received.flatMap((body) => {
      const payload = JSON.parse(body) as {
        resourceSpans: {
          scopeSpans: {
            spans: {
              name: string;
              traceId: string;
              spanId: string;
              parentSpanId?: string;
              startTimeUnixNano: string;
              endTimeUnixNano: string;
              attributes: {
                key: string;
                value: { stringValue?: string; intValue?: string };
              }[];
            }[];
          }[];
        }[];
      };
      return payload.resourceSpans.flatMap((r) =>
        r.scopeSpans.flatMap((s) => s.spans),
      );
    });
    const run = spans.find((span) => span.name === "agent.run")!;
    assert.ok(
      run,
      "Agent execution must be traced independently of HTTP admission",
    );
    const models = spans.filter((span) => span.name === "model.generate");
    assert.equal(
      models.length,
      2,
      "Trace each model turn around the approved tool call",
    );
    for (const model of models) {
      assert.equal(model.traceId, run.traceId);
      assert.equal(model.parentSpanId, run.spanId);
      assert.ok(
        BigInt(model.endTimeUnixNano) >= BigInt(model.startTimeUnixNano),
      );
      for (const key of [
        "session.id",
        "turn.id",
        "model.provider",
        "model.id",
        "model.input_tokens",
        "model.output_tokens",
        "model.stop_reason",
      ])
        assert.ok(
          model.attributes.some((attribute) => attribute.key === key),
          key,
        );
    }
    assert.ok(
      run.attributes.some(
        (a) => a.key === "turn.id" && a.value.stringValue === receipt.id,
      ),
    );
    const requestSpan = spans.find((span) => span.name === "http.request")!;
    assert.ok(
      requestSpan.attributes.some(
        (attribute) =>
          attribute.key === "http.route" &&
          attribute.value.stringValue === "/api/sessions/messages",
      ),
    );
  } finally {
    await http.close();
    await app.close();
    await telemetry.close();
    await collector.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("disabled tracing preserves behavior; malformed or credential-bearing exporters are rejected", async () => {
  const disabled = await createTelemetry();
  assert.equal(await disabled.run("runtime.start", {}, async () => 42), 42);
  await disabled.close();
  for (const endpoint of [
    "file:///tmp/traces",
    "https://user:password@localhost/v1/traces",
    "https://localhost/v1/traces?token=private",
  ])
    await assert.rejects(createTelemetry({ endpoint }), /OTLP endpoint/);
});

test("an unavailable collector cannot repeat or fail application work and shutdown is bounded", async () => {
  const collector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({}),
  });
  const endpoint = `http://127.0.0.1:${collector.port}/v1/traces`;
  await collector.stop(true);
  const telemetry = await createTelemetry({ endpoint, exportIntervalMs: 5 });
  let calls = 0;
  try {
    assert.equal(
      await telemetry.run("tool.call", { "tool.name": "fixture" }, async () => {
        calls++;
        return "confirmed";
      }),
      "confirmed",
    );
    assert.equal(calls, 1);
  } finally {
    const start = performance.now();
    await telemetry.close();
    assert.ok(
      performance.now() - start < 4000,
      "Exporter shutdown must be bounded",
    );
  }
  assert.equal(calls, 1);
});

test("failed model work reaches Diagnostics as an error with safe metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-model-traces-"));
  const collector = await openLocalOtlp(join(directory, "traces.sqlite"));
  const telemetry = await createTelemetry({
    endpoint: collector.endpoint,
    exportIntervalMs: 60_000,
  });
  const app = await Gateway.open({
    directory,
    telemetry,
    ...chatModel({ fail: true }),
  });
  try {
    const receipt = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "failure",
      text: "PRIVATE_FAILED_PROMPT",
    });
    await app.harness.waitForIdle(context);
    await app.close();
    await telemetry.close();
    const result = await collector.traces.read(1);
    const run = result.spans.find((s) => s.name === "agent.run");
    const model = result.spans.find((s) => s.name === "model.generate");
    assert.equal(run?.status, "error");
    assert.equal(model?.status, "error");
    assert.equal(model?.attributes["model.stop_reason"], "error");
    assert.equal(model?.attributes["turn.id"], receipt.id);
    assert.equal(model?.attributes["session.id"], receipt.sessionId);
    assert.equal(model?.attributes["model.input_tokens"], 1);
    assert.equal(
      JSON.stringify(result).includes("PRIVATE_FAILED_PROMPT"),
      false,
    );
    assert.equal(JSON.stringify(result).includes("Fixture failure"), false);
  } finally {
    await app.close();
    await telemetry.close();
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  }
});
