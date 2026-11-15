import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { decodeOtlpSpans } from "../src/domains/diagnostics/infrastructure/otlp-spans.ts";
import {
  botTelemetry,
  type Telemetry,
  type TraceAttributes,
} from "../src/shared/application/telemetry.ts";
import { chatModel } from "./chat-model.ts";

/** Records what each span was started with, and runs the work untraced. */
function recorder() {
  const spans: { name: string; attributes: TraceAttributes }[] = [];
  const telemetry: Telemetry = {
    start: (name, attributes) => {
      spans.push({ name, attributes });
      return { annotate: () => {}, end: () => {} };
    },
    run: (name, attributes, operation) => {
      spans.push({ name, attributes });
      return operation(() => {});
    },
  };
  return { spans, telemetry };
}

test("every span a bot starts carries its id, unless the span names another bot", async () => {
  const { spans, telemetry } = recorder();
  const research = botTelemetry(telemetry, "research");
  research.start("tool.call", { "tool.name": "search" });
  await research.run("model.generate", { "model.id": "fast" }, async () => {});
  research.start("http.request", { "bot.id": "default" });
  assert.deepEqual(
    spans.map((span) => [span.name, span.attributes["bot.id"]]),
    [
      ["tool.call", "research"],
      ["model.generate", "research"],
      ["http.request", "default"],
    ],
  );
  // The other attributes are untouched.
  assert.equal(spans[0]!.attributes["tool.name"], "search");
});

test("the trace store keeps a span's bot id and still drops unknown attributes", () => {
  const start = BigInt(Date.now()) * 1_000_000n;
  const text = (key: string, stringValue: string) => ({
    key,
    value: { stringValue },
  });
  const [span] = decodeOtlpSpans(
    {
      resourceSpans: [
        {
          resource: { attributes: [text("service.name", "raphie")] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "0".repeat(31) + "1",
                  spanId: "0".repeat(15) + "1",
                  name: "agent.run",
                  startTimeUnixNano: String(start),
                  endTimeUnixNano: String(start + 1_000_000n),
                  attributes: [
                    text("bot.id", "research"),
                    text("prompt", "PRIVATE"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    "raphie",
  );
  assert.equal(span!.attributes["bot.id"], "research");
  assert.equal("prompt" in span!.attributes, false);
});

test("a request is traced under the bot its route addresses, and trace polls are never traced", async () => {
  const { spans, telemetry } = recorder();
  const directory = await mkdtemp(join(tmpdir(), "raphie-bot-telemetry-"));
  const app = await Gateway.open({
    directory,
    ...chatModel({}),
    telemetry: botTelemetry(telemetry, "default"),
  });
  const http = await startServer(app, { port: 0 });
  try {
    const requests = () =>
      spans
        .filter((span) => span.name === "http.request")
        .map((span) => span.attributes["bot.id"]);
    await fetch(`${http.url}/api/sessions`);
    await fetch(`${http.url}/api/bots/research/sessions`);
    assert.deepEqual(requests(), ["default", "research"]);
    // Polling Diagnostics must not fill it with its own requests, through
    // the default routes or a bot's.
    await fetch(`${http.url}/api/diagnostics/traces?hours=1`);
    await fetch(`${http.url}/api/bots/default/diagnostics/traces?hours=1`);
    assert.equal(requests().length, 2);
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
