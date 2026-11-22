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
import type { JsonObject } from "@earendil-works/pi-durable";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import {
  Activity,
  record,
} from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { newSessionId } from "../src/domains/conversations/infrastructure/session-id.ts";
import { openLocalOtlp } from "../src/domains/diagnostics/infrastructure/local-otlp.ts";
import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { createTelemetry } from "../src/infrastructure/observability/effect-telemetry.ts";
import { switchableTelemetry } from "../src/infrastructure/observability/telemetry-switch.ts";
import { appDataIdentity } from "../src/infrastructure/workspace/app-data.ts";
import { botTelemetry } from "../src/shared/application/telemetry.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";
import { FakeTelegram } from "./fake-telegram.ts";
const directory = await mkdtemp(join(tmpdir(), "raphie-browser-"));
const nativeWorkspace = process.env.RAPHIE_FIXTURE_CONTAINER === "true";
const models = createModels();
const model = {
  ...openrouterProvider().getModels()[0],
  id: "acceptance",
  provider: "openrouter",
};

/** Today at `hour:minute` on this machine, with its UTC offset. */
function today(hour: number, minute = 0) {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  const offset = -at.getTimezoneOffset();
  const two = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(hour)}:${two(minute)}:00${offset < 0 ? "-" : "+"}${two(Math.trunc(offset / 60))}:${two(offset % 60)}`;
}

/** The date `days` from today on this machine, as YYYY-MM-DD. */
function dayFromNow(days: number) {
  const at = new Date();
  at.setDate(at.getDate() + days);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The card a message asks for, and the short reply that goes with it. */
function fixtureCard(
  input: string,
): { arguments: JsonObject; reply: string } | null {
  if (/my schedule/i.test(input))
    return {
      reply:
        "Five things today. Sprint planning overlaps the dentist, and I couldn't read the side-project calendar.",
      arguments: {
        title: new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        warning: "Side-project calendar couldn't be read",
        events: [
          {
            title: "Standup",
            detail: "Meet · 6 people",
            start: today(9, 30),
            end: today(9, 45),
            source: "Work calendar",
            url: "https://calendar.example.com/e/1",
          },
          {
            title: "1:1 with Mara",
            detail: "Room Baobab",
            start: today(13),
            end: today(13, 30),
            source: "Work calendar",
            url: "https://calendar.example.com/e/2",
          },
          {
            title: "Sprint planning",
            detail: "Meet · 9 people",
            start: today(14),
            end: today(15),
            source: "Work calendar",
            url: "https://calendar.example.com/e/3",
            link: { label: "Join", url: "https://meet.example.com/abc" },
          },
          {
            title: "Dentist",
            detail: "Bole Road clinic",
            start: today(14, 30),
            end: today(15, 15),
            source: "Personal calendar",
            url: "https://calendar.example.com/e/4",
          },
          {
            title: "Team farewell call",
            detail: "Zoom",
            start: today(23),
            end: today(23, 30),
            source: "Work calendar",
            link: { label: "Join", url: "https://zoom.example.com/j/1" },
          },
          {
            title: "Team farewell call",
            start: today(23),
            end: today(23, 30),
            source: "Personal calendar",
            url: "https://calendar.example.com/e/5",
          },
        ],
      },
    };
  if (/AF board/i.test(input))
    return {
      reply: "Seven open, one blocked on the vendor.",
      arguments: {
        title: "AF board · open",
        url: "https://example.atlassian.net/boards/7",
        source: "Jira",
        stats: [
          { label: "Open", value: "7" },
          { label: "In progress", value: "2" },
          { label: "Blocked", value: "1" },
        ],
        more: {
          label: "and 3 more in To do · Open in Jira",
          url: "https://example.atlassian.net/boards/7?status=todo",
        },
        groups: [
          {
            label: "In progress",
            rows: [
              {
                key: "AF-512",
                title: "Retry failed webhook deliveries",
                url: "https://example.atlassian.net/browse/AF-512",
                badge: { label: "High", tone: "bad" },
                trailing: "2d",
              },
              {
                key: "AF-498",
                title: "Export report as CSV",
                url: "https://example.atlassian.net/browse/AF-498",
                badge: { label: "Medium" },
                trailing: "5d",
              },
            ],
          },
          {
            label: "Blocked",
            rows: [
              {
                key: "AF-471",
                title: "Rotate payment provider keys",
                detail: "Waiting on vendor",
                url: "https://example.atlassian.net/browse/AF-471",
                badge: { label: "Blocked", tone: "attention" },
                trailing: "9d",
              },
            ],
          },
          {
            label: "To do",
            rows: [
              {
                key: "AF-520",
                title: "Paginate the audit log",
                url: "https://example.atlassian.net/browse/AF-520",
                badge: { label: "Medium" },
                trailing: "1d",
              },
            ],
          },
        ],
      },
    };
  if (/my review/i.test(input))
    return {
      reply: "Two. The oldest has waited three days.",
      arguments: {
        title: "Waiting for your review",
        groups: [
          {
            rows: [
              {
                key: "#214",
                title: "Cache board queries per sprint",
                detail: "acme/billing · by tesfa · +182 −40",
                url: "https://github.example.com/acme/billing/pull/214",
                badge: { label: "Checks pass", tone: "good" },
                trailing: "3d",
                source: "GitHub",
              },
              {
                key: "#87",
                title: "Drop the legacy export endpoint",
                detail: "acme/reports · by lior · +12 −310",
                url: "https://bitbucket.example.com/acme/reports/pull-requests/87",
                badge: { label: "Checks fail", tone: "bad" },
                link: {
                  label: "Checks",
                  url: "https://bitbucket.example.com/acme/reports/pipelines/87",
                },
                trailing: "5h",
                source: "Bitbucket",
              },
            ],
          },
        ],
      },
    };
  if (/fizzy board/i.test(input))
    return {
      reply: "Six cards on ALX - FIT. One in review is overdue.",
      arguments: {
        title: "ALX - FIT",
        url: "https://app.fizzy.example/boards/3",
        source: "Fizzy",
        columns: [
          {
            label: "Priority",
            color: "orange",
            rows: [
              {
                key: "#107",
                title: "Update the document with the AI update notes",
                url: "https://app.fizzy.example/cards/107",
                people: ["Kalkidan Betre"],
                tags: ["docs"],
                progress: { done: 2, total: 5 },
                trailing: "Nov 12",
              },
              {
                key: "#108",
                title: "AI 200 interactive elements (review request)",
                url: "https://app.fizzy.example/cards/108",
                people: ["Mara Tesfaye", "Kalkidan Betre"],
                due: dayFromNow(1),
                trailing: "Nov 12",
              },
            ],
          },
          {
            label: "In Review",
            color: "blue",
            count: 9,
            rows: [
              {
                key: "#94",
                title: "SE 202 Redesign",
                url: "https://app.fizzy.example/cards/94",
                people: ["Kalkidan Betre"],
                due: dayFromNow(-3),
                trailing: "Nov 3",
              },
              {
                key: "#93",
                title: "Review and Fix of Understanding AI",
                due: dayFromNow(12),
                trailing: "Oct 25",
              },
            ],
          },
          { label: "Done", color: "green", rows: [] },
          {
            rows: [
              {
                key: "#96",
                title: "SE 202 Course Overview needs to be re-built",
                trailing: "Oct 30",
              },
              { key: "#95", title: "Salary Acc Change", trailing: "Oct 27" },
            ],
          },
        ],
      },
    };
  if (/card 107/i.test(input))
    return {
      reply: "It's in Priority with two of five steps done.",
      arguments: {
        title: "Update the document with the AI update notes",
        url: "https://app.fizzy.example/cards/107",
        source: "Fizzy",
        more: { label: "4 comments · last from Mara, Nov 12" },
        item: {
          key: "#107",
          fields: [
            {
              label: "Column",
              badge: { label: "Priority", tone: "attention" },
            },
            { label: "Assigned", people: ["Kalkidan Betre"] },
            { label: "Due", due: dayFromNow(1) },
            { label: "Tags", tags: ["docs", "ai"] },
            { label: "Board", value: "ALX - FIT" },
          ],
          body: "Fold the notes from the AI 200 update into the course document, then ask for a second read.",
          steps: [
            { label: "Collect the update notes", done: true },
            { label: "Draft section 3", done: true },
            { label: "Update the glossary" },
            { label: "Ask for a second read" },
            { label: "Publish" },
            { label: "Tell the cohort" },
          ],
        },
      },
    };
  return null;
}

const reply: Provider["streamSimple"] = (_model, context, options) => {
  const stream = createAssistantMessageEventStream();
  const latestUser = context.messages.findLastIndex((m) => m.role === "user");
  const toolResult = context.messages
    .slice(latestUser + 1)
    .findLast((m) => m.role === "toolResult");
  const user = context.messages.findLast((m) => m.role === "user");
  const input = user && typeof user.content === "string" ? user.content : "";
  const remember = /remember tea/i.test(input);
  const useNative = nativeWorkspace && /native workspace/i.test(input);
  // "be blunt", "my time zone" and "release notes" show a bot updating
  // itself, the owner and its skills.
  const self: { name: string; arguments: JsonObject } | null = /be blunt/i.test(
    input,
  )
    ? {
        name: "update_personality",
        arguments: {
          personality:
            "Be blunt and direct. Skip pleasantries and lead with the answer.",
        },
      }
    : /my time zone/i.test(input)
      ? {
          name: "update_owner_profile",
          arguments: { callMe: "Hana", timeZone: "Africa/Addis_Ababa" },
        }
      : /release notes/i.test(input)
        ? {
            // Again with "lead with fixes" to show the bot improving it.
            name: "save_skill",
            arguments: {
              name: "release-notes",
              description:
                "Write release notes from the week's merged pull requests, grouped by area.",
              body: /lead with fixes/i.test(input)
                ? "1. List the merged pull requests.\n2. Lead with fixes.\n3. Group the rest by area."
                : "1. List the merged pull requests.\n2. Group them by area.",
            },
          }
        : null;
  // "my schedule", "AF board", "my review", "fizzy board" and "card 107"
  // show the kinds of card.
  const card = fixtureCard(input);
  // "dentist", "clinic" and "inbox" show the three kinds of question.
  const ask: JsonObject | null = /dentist/i.test(input)
    ? {
        question: "Dr. Amare has three openings next week. Which one?",
        options: [
          { label: "Tue 9:30" },
          { label: "Wed 14:00" },
          { label: "Fri 11:15" },
        ],
      }
    : /clinic/i.test(input)
      ? {
          question: "Which clinic should I book?",
          options: [
            { label: "Bole", detail: "Tue 9:30 · 12 minutes away" },
            { label: "Kazanchis", detail: "Fri 11:15 · 25 minutes away" },
          ],
        }
      : /inbox/i.test(input)
        ? {
            question: "214 newsletters are over a year old. Delete them?",
            options: [{ label: "Delete 214" }, { label: "Keep them" }],
            danger: true,
          }
        : null;
  const useTool =
    (/tool|approval/i.test(input) ||
      remember ||
      useNative ||
      !!ask ||
      !!card ||
      !!self) &&
    !toolResult;
  const text =
    toolResult?.role === "toolResult" && card
      ? card.reply
      : toolResult?.role === "toolResult"
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
            name: self
              ? self.name
              : card
                ? "show_card"
                : ask
                  ? "ask_owner"
                  : useNative
                    ? "bash"
                    : remember
                      ? "memory_retain"
                      : "mcp_fixture_execute",
            arguments: self
              ? self.arguments
              : card
                ? card.arguments
                : ask
                  ? ask
                  : useNative
                    ? {
                        command:
                          "echo 'Created through Pi bash' > /workspace/from-chat.txt; cat /workspace/from-chat.txt",
                      }
                    : remember
                      ? { content: "Owner prefers jasmine tea", kind: "fact" }
                      : {
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
    // "provider error" in a message shows how a failed reply reads.
    if (/provider error/i.test(input)) {
      stream.push({
        type: "error",
        reason: "error",
        error: {
          ...message,
          stopReason: "error",
          errorMessage:
            "429 Too Many Requests: rate limit reached for requests per minute. Try again in 20s.",
        },
      });
      return;
    }
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
    ...(process.env.RAPHIE_FIXTURE_MODEL_CATALOG === "long"
      ? Array.from({ length: 100 }, (_, index) => ({
          ...model,
          id: `${index % 2 ? "fixture-a" : "fixture-b"}/model-${index}`,
          name: `Fixture model ${index}`,
        }))
      : []),
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
const fixtureProvider = models.getProvider("openrouter")!;
const settings = await BackendSettings.open(
  join(directory, "settings.sqlite"),
  {
    models,
    credentialKeyStore: memoryCredentialKeyStore(),
    defaultModel: model.id,
    verifyKey: async (key) => {
      if (key !== "fixture" && key !== "fixture-browser-key")
        throw new Error("Invalid fixture key");
    },
  },
);
await settings.addConnection({
  provider: "openrouter",
  name: "Fixture",
  apiKey: "fixture",
});
const collector = await openLocalOtlp(join(directory, "traces.sqlite"));
const exporter = await createTelemetry({ endpoint: collector.endpoint });
const telemetry = switchableTelemetry(
  exporter,
  () => settings.telemetryEnabled,
);
const memory = new RuntimeMemory(
  join(directory, "memory.sqlite"),
  settings,
  settings.connectionGate,
);
// Opt-in inventory for browsing/pagination acceptance; always disposable data.
if (process.env.RAPHIE_FIXTURE_MEMORY_HISTORY === "true") {
  for (let index = 1; index <= 60; index++) {
    const suffix = String(index).padStart(3, "0");
    await memory.retain({
      id: `fixture-memory-${suffix}`,
      content:
        index === 7
          ? "Fixture preference: jasmine tea"
          : `Fixture memory ${suffix}: a synthetic preference for browsing acceptance.`,
      kind: index % 2 ? "fact" : "experience",
      source: `fixture:memory-${suffix}`,
      eventTime: Date.now() - index * 1000,
    });
  }
}
const app = await Gateway.open({
  containerNamePrefix: "raphie-test",
  identity: { ...(await appDataIdentity(directory)), kind: "fixture" },
  deferResume: true,
  memory,
  modelConnectionGate: settings.connectionGate,
  directory,
  models,
  model: settings.model,
  telemetry: botTelemetry(telemetry, "default"),
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
if (process.env.RAPHIE_FIXTURE_WORKSPACE_FILES === "true") {
  await app.workspace.execute(
    "fixture",
    "workspace-seed",
    "mkdir reports; echo 'A workspace report' > reports/summary.txt; echo AP8= | base64 -d > sample.bin; echo '<h1>Download only</h1>' > 'report 中文.html'; ln -s reports/summary.txt latest",
  );
}
if (nativeWorkspace) {
  await app.saveSandboxSettings({
    ...(await app.workspace.info()).settings,
    provider: "container",
    hostNetworkAcknowledged: true,
  });
  await app.workspace
    .env("fixture-seed")
    .exec(
      "mkdir -p reports; echo 'Live container report' > reports/summary.txt; ln -s reports/summary.txt latest",
      {},
      durableContext,
    );
}
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
        ...(n === 56
          ? {
              compaction: {
                at: now + n,
                reason: "threshold" as const,
                summary:
                  "## Goal\nReview the launch plan question by question.\n\n## Constraints & Preferences\n- Keep replies short; tables over prose.\n\n## Progress\n### Done\n- [x] Questions 1–55 reviewed\n\n### In Progress\n- [ ] The remaining questions\n\n## Key Decisions\n- **Ship Thursday**: the owner confirmed the date in question 12.\n\n## Next Steps\n1. Answer question 57\n\n## Critical Context\n- (none)",
              },
            }
          : {}),
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
memory.isBusy = settings.isBusy = async () =>
  (await app.chats.state()).turns.some((turn) => turn.status === "pending");
const telegram = new FakeTelegram();
const bots = await BotHost.open(
  directory,
  { gateway: app, settings, memory },
  async (botId, path) => {
    const botModels = createModels();
    botModels.setProvider(fixtureProvider);
    const botSettings = await BackendSettings.open(
      join(path, "settings.sqlite"),
      {
        models: botModels,
        credentialKeyStore: memoryCredentialKeyStore(),
        defaultModel: model.id,
        verifyKey: async () => {},
      },
    );
    const botMemory = new RuntimeMemory(
      join(path, "memory.sqlite"),
      botSettings,
      botSettings.connectionGate,
      botId,
    );
    const gateway = await Gateway.open({
      containerNamePrefix: "raphie-test",
      deferResume: true,
      directory: path,
      botId,
      telemetry: botTelemetry(telemetry, botId),
      models: botModels,
      model: botSettings.model,
      memory: botMemory,
      modelConnectionGate: botSettings.connectionGate,
    });
    botSettings.onChange = () => {
      gateway.chats.model = botSettings.model;
    };
    botMemory.isBusy = botSettings.isBusy = async () =>
      (await gateway.chats.state()).turns.some(
        (turn) => turn.status === "pending",
      );
    return {
      gateway,
      settings: botSettings,
      memory: botMemory,
      close: async () => {
        await gateway.close();
        botMemory.close();
        botSettings.close();
      },
    };
  },
  {
    keyStore: memoryCredentialKeyStore(),
    // Telegram traffic goes to a local fake; the fixture never contacts Telegram.
    telegram: { apiBase: telegram.url, pollSeconds: 1 },
  },
);
// Override the ports to run beside a real runtime.
const server = await startServer(app, {
  bots,
  settings,
  memory,
  diagnostics: collector.traces,
  port: Number(process.env.RAPHIE_FIXTURE_PORT ?? 4317),
  webOrigin: process.env.RAPHIE_FIXTURE_WEB_ORIGIN ?? "http://127.0.0.1:4321",
});
console.log(`Browser fixture: ${server.url}`);
console.log(
  `Fake Telegram API: ${telegram.url} (token ${telegram.token}; POST /__text {"user":1,"text":"/pair CODE"})`,
);
await new Promise<void>((done) => {
  process.once("SIGINT", done);
  process.once("SIGTERM", done);
});
await server.close();
await bots.close();
await telegram.stop();
await app.close();
await exporter.close();
await collector.close();
memory.close();
settings.close();
await rm(directory, { recursive: true, force: true });
