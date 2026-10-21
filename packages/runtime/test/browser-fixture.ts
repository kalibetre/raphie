// Local browser acceptance fixture: real Pi/SQLite/HTTP; no external services.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as durableContext } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import {
  Activity,
  record,
} from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { newSessionId } from "../src/domains/conversations/infrastructure/session-id.ts";
import { openLocalOtlp } from "../src/domains/diagnostics/infrastructure/local-otlp.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { createTelemetry } from "../src/infrastructure/observability/effect-telemetry.ts";
import { switchableTelemetry } from "../src/infrastructure/observability/telemetry-switch.ts";
const directory = await mkdtemp(join(tmpdir(), "raphie-browser-"));
const models = createModels();
const model = {
  ...openrouterProvider().getModels()[0],
  id: "acceptance",
  provider: "openrouter",
};
const reply: Provider["streamSimple"] = (_model, context, options) => {
  const stream = createAssistantMessageEventStream();
  const toolResult = context.messages.findLast((m) => m.role === "toolResult");
  const user = context.messages.findLast((m) => m.role === "user");
  const input = user && typeof user.content === "string" ? user.content : "";
  const useTool = /tool|approval/i.test(input) && !toolResult;
  const text =
    toolResult?.role === "toolResult"
      ? toolResult.content
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("")
      : `Let’s make some room for the day.\n\n1. **Choose one priority.** Start with the work that matters most.\n2. **Leave a little breathing room.** Keep a gap between meetings.\n3. **Close the loop.** Write down your next step before you finish.\n\nWhat would you like to focus on first?`;
  const message: AssistantMessage = {
    role: "assistant",
    content: useTool
      ? [
          {
            type: "toolCall",
            id: "test-call",
            name: "mcp_fixture_execute",
            arguments: {
              code: 'return calendar.events.list({ date: "2026-10-21" });',
            },
          },
        ]
      : [{ type: "text", text: "" }],
    api: model.api,
    provider: "openrouter",
    model: _model.id,
    stopReason: useTool ? "toolUse" : "stop",
    timestamp: Date.now(),
    usage: {
      input: 24,
      output: 64,
      totalTokens: 88,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  void (async () => {
    stream.push({ type: "start", partial: structuredClone(message) });
    if (!useTool) {
      for (const delta of text.match(/.{1,8}/gs) ?? []) {
        await delay(90);
        if (options?.signal?.aborted) break;
        const content = message.content[0];
        if (content.type === "text") content.text += delta;
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta,
          partial: structuredClone(message),
        });
      }
    }
    stream.push({
      type: "done",
      reason: useTool ? "toolUse" : "stop",
      message,
    });
  })();
  return stream;
};
models.setProvider({
  id: "openrouter",
  name: "Fixture",
  getModels: () => [
    model,
    { ...model, id: "acceptance-alternate", name: "Acceptance alternate" },
  ],
  auth: {
    apiKey: {
      name: "Fixture",
      resolve: async () => ({ auth: { apiKey: "test" } }),
    },
  },
  stream: (m, c, o) => reply(m, c, { signal: o?.signal }),
  streamSimple: reply,
});
const settings = await BackendSettings.open(
  join(directory, "settings.sqlite"),
  {
    models,
    defaultModel: model.id,
    environmentKey: "fixture",
    verifyKey: async (key) => {
      if (key !== "fixture" && key !== "fixture-browser-key")
        throw new Error("Invalid fixture key");
    },
  },
);
const collector = await openLocalOtlp(join(directory, "traces.sqlite"));
const exporter = await createTelemetry({ endpoint: collector.endpoint });
const telemetry = switchableTelemetry(
  exporter,
  () => settings.telemetryEnabled,
);
const app = await Gateway.open({
  directory,
  models,
  model: settings.model,
  telemetry,
  mcp: {
    identity: "acceptance",
    client: {
      server: { name: "fixture", version: "1" },
      tools: [
        {
          name: "execute",
          description: "Fixture calendar lookup",
          inputSchema: {
            type: "object",
            properties: { code: { type: "string" } },
          },
        },
      ],
      call: async () => ({
        content: [
          {
            type: "text",
            text: "Calendar checked. You have a planning session at 10:00 and the afternoon is clear.",
          },
        ],
      }),
      close: async () => {},
    },
  },
});
// Opt-in dense UI fixture: synthetic history stays inside the disposable database.
if (process.env.RAPHIE_FIXTURE_LONG_HISTORY === "true") {
  await app.root.commit(async (tx) => {
    const created = await tx.createConversation({
      ownership: { kind: "ownerless" },
    });
    const state = await tx.doc(Chats);
    const now = Date.now();
    state.conversations.push({
      id: created.id,
      sessionId: newSessionId(),
      title: "Scroll layout acceptance",
      createdAt: now,
    });
    for (let n = 0; n < 60; n++) {
      const id = crypto.randomUUID();
      state.turns.push({
        id,
        requestKey: `fixture:${n}`,
        fingerprint: "fixture",
        conversationId: created.id,
        source: "web",
        text: `Question ${n + 1}: review the plan`,
        createdAt: now + n,
        status: "done",
        answer: `Reply ${n + 1}. Here is a longer response to exercise transcript scrolling.\n\n${"A useful paragraph with enough detail to wrap across the available width. ".repeat(6)}\n\n\`\`\`ts\n${"const value = 'a deliberately wide code sample for horizontal scrolling'; ".repeat(8)}\n\`\`\`\n\n| Step | Result |\n| --- | --- |\n| Check | Passed |`,
      });
      record(
        await tx.doc(Activity),
        "run.completed",
        `Fixture reply ${n + 1}`,
        {
          conversationId: created.id,
          runId: id,
          details: {
            rows: Array.from({ length: 40 }, (_, index) => ({
              index,
              value: "Detailed fixture data",
            })),
          },
        },
      );
    }
  }, durableContext);
}
settings.onChange = () => {
  app.chats.model = settings.model;
};
settings.isBusy = async () =>
  (await app.chats.state()).turns.some((turn) => turn.status === "pending");
// Override the ports to run beside a real runtime.
const server = await startServer(app, {
  settings,
  diagnostics: collector.traces,
  port: Number(process.env.RAPHIE_FIXTURE_PORT ?? 4317),
  webOrigin: process.env.RAPHIE_FIXTURE_WEB_ORIGIN ?? "http://127.0.0.1:4321",
});
console.log(`Browser fixture: ${server.url}`);
await new Promise<void>((done) => {
  process.once("SIGINT", done);
  process.once("SIGTERM", done);
});
await server.close();
await app.close();
await exporter.close();
await collector.close();
settings.close();
await rm(directory, { recursive: true, force: true });
