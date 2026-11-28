import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { ServerWebSocket } from "bun";

import type { ChannelServices } from "../src/application/channels/ports.ts";
import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import {
  isPrivateDestination,
  parseConversation,
} from "../src/domains/channels/domain/binding.ts";
import {
  BotSlack,
  SlackConnections,
} from "../src/domains/channels/infrastructure/bot-slack.ts";
import {
  chatSdkRenderer,
  decodeChatSdkOperation,
} from "../src/infrastructure/chat-sdk/delivery.ts";
import {
  createSlackBridge,
  resolveSlackIdentity,
  slackAuthorized,
} from "../src/infrastructure/slack/bridge.ts";
import { chatModel } from "./chat-model.ts";

const OWNER = "U0OWNER";
const DM = "D0OWNER";

async function until(check: () => boolean | Promise<boolean>, what = "state") {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

function keyStore() {
  const keys = new Map<string, string>();
  return {
    get: async (id: string) => keys.get(id) ?? null,
    set: async (id: string, value: string) => {
      keys.set(id, value);
    },
  };
}

/** Slack's Web API and its Socket Mode WebSocket, on loopback. */
function fakeSlack() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const acks: string[] = [];
  let socket: ServerWebSocket<unknown> | undefined;
  let posted = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/socket")
        return server.upgrade(request)
          ? undefined
          : new Response("", { status: 400 });
      const method = url.pathname.replace(/^\/api\//, "");
      const text = await request.text();
      const body = request.headers
        .get("content-type")
        ?.includes("application/json")
        ? (JSON.parse(text || "{}") as Record<string, unknown>)
        : Object.fromEntries(new URLSearchParams(text));
      calls.push({ method, body });
      if (method === "auth.test")
        return Response.json({
          ok: true,
          team_id: "T0TEAM",
          team: "Fixture",
          user_id: "U0BOT",
          bot_id: "B0BOT",
          user: "raphie",
        });
      if (method === "apps.connections.open")
        return Response.json({
          ok: true,
          url: `ws://127.0.0.1:${server.port}/socket`,
        });
      if (method === "chat.postMessage")
        return Response.json({
          ok: true,
          channel: body.channel,
          ts: `1700000100.00000${++posted}`,
        });
      if (method === "chat.postEphemeral")
        return Response.json({ ok: true, message_ts: "1700000200.000001" });
      return Response.json({ ok: true });
    },
    websocket: {
      open(ws) {
        socket = ws;
        ws.send(
          JSON.stringify({
            type: "hello",
            num_connections: 1,
            connection_info: { app_id: "A0APP" },
            debug_info: { approximate_connection_time: 3600 },
          }),
        );
      },
      message(_ws, message) {
        const { envelope_id } = JSON.parse(String(message)) as {
          envelope_id?: string;
        };
        if (envelope_id) acks.push(envelope_id);
      },
    },
  });
  let envelopes = 0;
  return {
    server,
    calls,
    acks,
    apiUrl: `http://127.0.0.1:${server.port}/api/`,
    connected: () => !!socket,
    /** Delivers one Socket Mode envelope and returns its id. */
    send(type: string, payload: Record<string, unknown>) {
      const envelope_id = `envelope-${++envelopes}`;
      socket!.send(
        JSON.stringify({
          envelope_id,
          type,
          payload,
          accepts_response_payload: false,
        }),
      );
      return envelope_id;
    },
  };
}

function directMessage(user: string, text: string, ts: string) {
  return {
    type: "event_callback",
    team_id: "T0TEAM",
    api_app_id: "A0APP",
    event_id: `Ev${ts}`,
    event_time: 1700000000,
    event: {
      type: "message",
      channel: DM,
      channel_type: "im",
      user,
      text,
      ts,
    },
  };
}

test("Slack platform: conversation IDs, private chats and access policy", () => {
  assert.deepEqual(parseConversation("slack", "slack:C0CHAN:1700.01"), {
    channelId: "C0CHAN",
    threadId: "1700.01",
  });
  assert.deepEqual(parseConversation("slack", `slack:${DM}:`), {
    channelId: DM,
  });
  assert.equal(
    isPrivateDestination({ provider: "slack", conversation: `slack:${DM}:` }),
    true,
  );
  assert.equal(
    isPrivateDestination({
      provider: "slack",
      conversation: "slack:C0CHAN:1700.01",
    }),
    false,
  );
  assert.equal(slackAuthorized(OWNER, [OWNER], DM), true);
  assert.equal(slackAuthorized("U0OTHER", [OWNER], DM), false);
  assert.equal(slackAuthorized(OWNER, [OWNER], "C0CHAN", "C0CHAN"), true);
  assert.equal(slackAuthorized(OWNER, [OWNER], "C0OTHER", "C0CHAN"), false);
});

test("Slack identity comes from auth.test and rejects anything else", async () => {
  const ok = async () =>
    Response.json({
      ok: true,
      team_id: "T0TEAM",
      team: "Fixture",
      user_id: "U0BOT",
    });
  assert.deepEqual(await resolveSlackIdentity("xoxb-fixture", ok), {
    connectionId: "slack:T0TEAM:U0BOT",
    teamName: "Fixture",
    botUserId: "U0BOT",
  });
  await assert.rejects(
    resolveSlackIdentity("xoxb-fixture", async () =>
      Response.json({ ok: false, error: "invalid_auth" }),
    ),
    /Invalid Slack identity/,
  );
});

test("Slack replies are Markdown in chunks Slack accepts", async () => {
  const render = chatSdkRenderer(
    { read: async () => new Uint8Array() } as never,
    { chunk: 10_000, format: "markdown" },
  );
  const parts = await render({
    source: "chat",
    threadId: `slack:${DM}:`,
    text: "x".repeat(25_000),
  } as never);
  assert.equal(parts.length, 3);
  const first = decodeChatSdkOperation(parts[0]!);
  assert.equal(first.threadId, `slack:${DM}:`);
  assert.deepEqual(first.message, {
    markdown: "x".repeat(10_000),
    files: undefined,
  });
});

test("Slack over Socket Mode: allow-listed DMs reach the bot, replies post back, /home selects the DM", async () => {
  const slack = fakeSlack();
  // The adapter must reach only the fixture; any other host fails the test.
  const originalFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const [input] = args;
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        assert.equal(url.hostname, "127.0.0.1", "Tests must not contact Slack");
        return originalFetch(...args);
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  const directory = await mkdtemp(join(tmpdir(), "raphie-slack-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  const bridge = createSlackBridge(app, {
    botToken: "xoxb-fixture-token",
    appToken: "xapp-fixture-token",
    connectionId: "slack:T0TEAM:U0BOT",
    botUserId: "U0BOT",
    allowedUserIds: [OWNER],
    apiUrl: slack.apiUrl,
  });
  try {
    await bridge.chat.initialize();
    await until(slack.connected, "Socket Mode connection");

    const denied = slack.send(
      "events_api",
      directMessage("U0STRANGER", "let me in", "1700000000.000001"),
    );
    await until(() => slack.acks.includes(denied), "ack of a stranger's DM");
    await delay(50);
    assert.equal((await app.chats.state()).turns.length, 0);

    const hello = slack.send(
      "events_api",
      directMessage(OWNER, "hello from Slack", "1700000000.000002"),
    );
    await until(() => slack.acks.includes(hello), "ack of the owner's DM");
    await until(
      async () => (await app.chats.state()).turns.length === 1,
      "the owner's turn",
    );
    const [turn] = (await app.chats.state()).turns;
    assert.equal(turn?.source, "slack");
    assert.deepEqual(turn?.replyTo, {
      provider: "slack",
      owner: "owner",
      connectionId: "slack:T0TEAM:U0BOT",
      conversation: `slack:${DM}:`,
    });

    await until(async () => {
      await bridge.flush();
      return slack.calls.some((c) => c.method === "chat.postMessage");
    }, "the reply");
    const reply = slack.calls.find((c) => c.method === "chat.postMessage")!;
    assert.equal(reply.body.channel, DM);
    assert.equal(typeof reply.body.markdown_text, "string");

    const home = slack.send("slash_commands", {
      command: "/home",
      text: "",
      user_id: OWNER,
      user_name: "owner",
      channel_id: DM,
      team_id: "T0TEAM",
      trigger_id: "trigger-1",
      response_url: `${slack.apiUrl}response`,
    });
    await until(() => slack.acks.includes(home), "ack of /home");
    await until(
      async () => !!(await app.home.read()).selected,
      "home selected",
    );
    assert.equal(
      (await app.home.read()).destinations.find((d) => d.platform === "slack")
        ?.conversationId,
      `slack:${DM}:`,
    );
  } finally {
    await bridge.chat.shutdown();
    await app.close();
    fetchSpy.mockRestore();
    await slack.server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Slack settings are encrypted, survive a restart, keep saved tokens and stay with one bot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-slack-store-"));
  const store = keyStore();
  const starts: string[] = [];
  let stopped = 0;
  const adapters = {
    identity: async () => ({
      connectionId: "slack:T0TEAM:U0BOT",
      teamName: "Fixture",
      botUserId: "U0BOT",
    }),
    create: ((_app, config) => {
      starts.push(`${config.botToken} ${config.appToken}`);
      return {
        chat: {
          initialize: async () => {},
          shutdown: async () => {
            stopped++;
          },
        },
        flush: async () => {},
      } as unknown as ReturnType<typeof createSlackBridge>;
    }) as typeof createSlackBridge,
  };
  const app = {} as ChannelServices;
  const connections = new SlackConnections();
  const path = join(directory, "one.sqlite");
  let first = await BotSlack.open(path, app, store, adapters, connections);
  const second = await BotSlack.open(
    join(directory, "two.sqlite"),
    app,
    store,
    adapters,
    connections,
  );
  const input = {
    botToken: "xoxb-private-bot-token",
    appToken: "xapp-private-app-token",
    allowedUserIds: [OWNER],
    channelId: "C0CHAN",
  };
  try {
    const saved = await first.save(input);
    assert.equal(saved.slack?.connected, true);
    assert.equal(saved.slack?.teamName, "Fixture");
    assert.doesNotMatch(JSON.stringify(first.read()), /private/);
    const file = await readFile(path);
    assert.equal(file.includes(input.botToken), false);
    assert.equal(file.includes(input.appToken), false);

    await first.save({ allowedUserIds: [OWNER], channelId: "" });
    await first.close();
    first = await BotSlack.open(path, app, store, adapters, connections);
    assert.equal(first.read().slack?.channelId, "");
    assert.deepEqual(
      new Set(starts),
      new Set([`${input.botToken} ${input.appToken}`]),
    );

    assert.equal(
      first.acceptsHome({
        provider: "slack",
        owner: "owner",
        connectionId: "slack:T0TEAM:U0BOT",
        conversation: `slack:${DM}:`,
        userId: OWNER,
      }),
      true,
    );
    assert.equal(
      first.acceptsHome({
        provider: "slack",
        owner: "owner",
        connectionId: "slack:T0TEAM:U0BOT",
        conversation: `slack:${DM}:`,
        userId: "U0OTHER",
      }),
      false,
    );

    await assert.rejects(
      second.save(input),
      /already connected to another bot/,
    );
    assert.equal(second.read().slack, null);

    assert.equal((await first.remove()).slack, null);
    assert.ok(stopped > 0);
    assert.equal((await second.save(input)).slack?.connected, true);
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});
