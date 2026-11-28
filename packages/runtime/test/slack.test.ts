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
  type SlackAdapters,
  SlackConnections,
} from "../src/domains/channels/infrastructure/bot-slack.ts";
import {
  chatSdkRenderer,
  decodeChatSdkOperation,
} from "../src/infrastructure/chat-sdk/delivery.ts";
import {
  createSlackBridge,
  resolveSlackIdentity,
  slackAppId,
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
      if (method === "users.info")
        return Response.json({
          ok: true,
          user: {
            id: body.user,
            name: body.user === "U0BOT" ? "raphie" : "owner",
            // A display name with a space, as the guide suggests renaming it.
            profile: {
              display_name: body.user === "U0BOT" ? "Raphie Bot" : "Owner",
            },
          },
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
  // The app comes from auth.test, or else from the bot's own record.
  const named = async () =>
    Response.json({
      ok: true,
      team_id: "T0TEAM",
      user_id: "U0BOT",
      app_id: "A0APP",
    });
  assert.equal(
    (await resolveSlackIdentity("xoxb-fixture", named)).appId,
    "A0APP",
  );
  const asked: string[] = [];
  const viaBot = async (input: Parameters<typeof fetch>[0]) => {
    const url =
      input instanceof Request ? input.url : (input as string | URL).toString();
    asked.push(url);
    return url.includes("bots.info")
      ? Response.json({ ok: true, bot: { id: "B0BOT", app_id: "A0OTHER" } })
      : Response.json({
          ok: true,
          team_id: "T0TEAM",
          user_id: "U0BOT",
          bot_id: "B0BOT",
        });
  };
  assert.equal(
    (await resolveSlackIdentity("xoxb-fixture", viaBot)).appId,
    "A0OTHER",
  );
  assert.ok(asked.some((url) => url.endsWith("bots.info?bot=B0BOT")));
  await assert.rejects(
    resolveSlackIdentity("xoxb-fixture", async () =>
      Response.json({ ok: false, error: "invalid_auth" }),
    ),
    /Invalid Slack identity/,
  );
});

test("An app-level token names its app", () => {
  assert.equal(slackAppId("xapp-1-A0APP123-4567890123-abcdef0123"), "A0APP123");
  assert.equal(slackAppId("xapp-private-app-token"), undefined);
  assert.equal(slackAppId("xoxb-1-A0APP123-1-x"), undefined);
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
  const follows: string[] = [];
  const bridge = createSlackBridge(app, {
    botToken: "xoxb-fixture-token",
    appToken: "xapp-fixture-token",
    connectionId: "slack:T0TEAM:U0BOT",
    botUserId: "U0BOT",
    allowedUserIds: [OWNER],
    apiUrl: slack.apiUrl,
    // A thread the bot followed before a restart.
    followed: ["slack:C0CHAN:1699999999.000001"],
    onFollow: (thread) => follows.push(thread),
  });
  try {
    await bridge.connect();
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
    // A timestamp is unique only per channel, so the event ID carries both.
    assert.ok(turn?.requestKey.endsWith(`${DM}:1700000000.000002`));
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

    // A button on a card at the DM's top level: the press names the card's
    // own timestamp, but it must count for the conversation it was posted to.
    const decide = spyOn(app.sessions, "decide").mockResolvedValue(
      "approved" as never,
    );
    const answer = spyOn(app.asks, "answer").mockResolvedValue(
      "answered" as never,
    );
    const press = (user: string, action_id: string, value: string) =>
      slack.send("interactive", {
        type: "block_actions",
        user: { id: user, username: user },
        team: { id: "T0TEAM" },
        channel: { id: DM, name: "directmessage" },
        container: {
          type: "message",
          message_ts: "1700000100.000001",
          channel_id: DM,
          is_ephemeral: false,
        },
        message: { type: "message", ts: "1700000100.000001", text: "card" },
        trigger_id: "trigger-press",
        response_url: `${slack.apiUrl}response`,
        actions: [
          {
            type: "button",
            action_id,
            block_id: "actions",
            value,
            action_ts: "1700000200.000001",
          },
        ],
      });
    const stranger = press("U0STRANGER", "raphie-tool-approve", "approval-1");
    await until(
      () => slack.acks.includes(stranger),
      "ack of a stranger's press",
    );
    await delay(50);
    assert.equal(decide.mock.calls.length, 0);
    press(OWNER, "raphie-tool-approve", "approval-1");
    await until(() => decide.mock.calls.length === 1, "the approval press");
    assert.equal(decide.mock.calls[0]![0].threadId, `slack:${DM}:`);
    assert.equal(decide.mock.calls[0]![2], "approved");
    press(OWNER, "raphie-ask", "ask-1:0");
    await until(() => answer.mock.calls.length === 1, "the question press");
    assert.equal(answer.mock.calls[0]![5]?.threadId, `slack:${DM}:`);
    decide.mockRestore();
    answer.mockRestore();

    // In a channel, the bot's own @mention is dropped even when its display
    // name has a space; the rest of the prompt is kept whole.
    const mention = slack.send("events_api", {
      type: "event_callback",
      team_id: "T0TEAM",
      api_app_id: "A0APP",
      event_id: "EvMention",
      event_time: 1700000000,
      event: {
        type: "app_mention",
        channel: "C0CHAN",
        user: OWNER,
        text: "<@U0BOT> do the thing",
        ts: "1700000000.000003",
      },
    });
    await until(() => slack.acks.includes(mention), "ack of the mention");
    await until(
      async () => (await app.chats.state()).turns.length === 2,
      "the mention's turn",
    );
    const mentioned = (await app.chats.state()).turns.at(-1)!;
    assert.equal(mentioned.text, "do the thing");
    assert.equal(
      mentioned.replyTo?.conversation,
      "slack:C0CHAN:1700000000.000003",
    );
    // The mentioned thread is followed, and remembered across restarts.
    await until(
      () => follows.includes("slack:C0CHAN:1700000000.000003"),
      "the thread followed",
    );

    // A thread remembered from before reaches the bot without a mention.
    const threadReply = slack.send("events_api", {
      type: "event_callback",
      team_id: "T0TEAM",
      api_app_id: "A0APP",
      event_id: "EvFollowed",
      event_time: 1700000000,
      event: {
        type: "message",
        channel: "C0CHAN",
        channel_type: "channel",
        user: OWNER,
        text: "and one more thing",
        ts: "1700000000.000004",
        thread_ts: "1699999999.000001",
      },
    });
    await until(
      () => slack.acks.includes(threadReply),
      "ack of the thread reply",
    );
    await until(
      async () => (await app.chats.state()).turns.length === 3,
      "the remembered thread's turn",
    );
    const followed = (await app.chats.state()).turns.at(-1)!;
    assert.equal(followed.text, "and one more thing");
    assert.equal(
      followed.replyTo?.conversation,
      "slack:C0CHAN:1699999999.000001",
    );

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
    await bridge.close();
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
        connect: async () => {},
        close: async () => {
          stopped++;
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
    // A restart connects in the background.
    await until(() => first.read().slack?.connected === true, "reconnect");
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

test("An unreachable Slack never holds up startup, and a save gives up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-slack-down-"));
  const store = keyStore();
  let reachable = true;
  let closed = 0;
  const adapters = {
    identity: async () => ({
      connectionId: "slack:T0TEAM:U0BOT",
      teamName: "Fixture",
      botUserId: "U0BOT",
    }),
    create: (() =>
      ({
        // The SDK keeps retrying an unreachable Slack: it never settles.
        connect: () =>
          reachable ? Promise.resolve() : new Promise<void>(() => {}),
        close: async () => {
          closed++;
        },
        flush: async () => {},
      }) as unknown as ReturnType<
        typeof createSlackBridge
      >) as typeof createSlackBridge,
    connectTimeoutMs: 50,
  };
  const app = {} as ChannelServices;
  const path = join(directory, "slack.sqlite");
  const input = {
    botToken: "xoxb-private-bot-token",
    appToken: "xapp-private-app-token",
    allowedUserIds: [OWNER],
  };
  let bot = await BotSlack.open(path, app, store, adapters);
  try {
    await bot.save(input);
    await bot.close();

    reachable = false;
    bot = await BotSlack.open(path, app, store, adapters);
    assert.equal(bot.read().slack?.connected, false);

    await assert.rejects(bot.save(input), /Slack is reachable/);
    assert.equal(bot.read().slack?.connected, false);
    // Neither the failed save nor a hanging connection blocks removing it.
    assert.equal((await bot.remove()).slack, null);
    assert.ok(closed >= 2);
  } finally {
    await bot.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("One Slack app serves one bot, whatever bot token each bot is given", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-slack-app-"));
  const store = keyStore();
  const followed: string[][] = [];
  let follow: ((thread: string) => void) | undefined;
  // Each bot token is a different bot user; the app comes from the token.
  const adapters: SlackAdapters = {
    identity: async (botToken) => ({
      connectionId: `slack:T0TEAM:${botToken.includes("two") ? "U0TWO" : "U0ONE"}`,
      teamName: "Fixture",
      botUserId: botToken.includes("two") ? "U0TWO" : "U0ONE",
      appId: botToken.includes("other") ? "A0OTHER" : "A0APP",
    }),
    create: ((_app, config) => {
      followed.push(config.followed ?? []);
      follow = config.onFollow;
      return {
        connect: async () => {},
        close: async () => {},
        flush: async () => {},
      } as unknown as ReturnType<typeof createSlackBridge>;
    }) as typeof createSlackBridge,
  };
  const connections = new SlackConnections();
  const app = {} as ChannelServices;
  const appToken = "xapp-1-A0APP-1700000000000-secret";
  const path = join(directory, "one.sqlite");
  let one = await BotSlack.open(path, app, store, adapters, connections);
  const two = await BotSlack.open(
    join(directory, "two.sqlite"),
    app,
    store,
    adapters,
    connections,
  );
  try {
    await one.save({ botToken: "xoxb-one", appToken, allowedUserIds: [OWNER] });
    // A different bot token, but the same app-level token: refused.
    await assert.rejects(
      two.save({ botToken: "xoxb-two", appToken, allowedUserIds: [OWNER] }),
      /already connected to another bot/,
    );
    // A bot token from another app than the app-level token: refused.
    await assert.rejects(
      two.save({
        botToken: "xoxb-two-other",
        appToken,
        allowedUserIds: [OWNER],
      }),
      /different Slack apps/,
    );
    assert.equal(two.read().slack, null);

    // Followed threads survive a restart, newest first, and go with Remove.
    follow!("slack:C0CHAN:1.000001");
    await Bun.sleep(2);
    follow!("slack:C0CHAN:2.000002");
    await one.close();
    one = await BotSlack.open(path, app, store, adapters, connections);
    assert.deepEqual(followed.at(-1), [
      "slack:C0CHAN:2.000002",
      "slack:C0CHAN:1.000001",
    ]);
    // A restarted bot holds its app again; the other still cannot take it.
    assert.equal(two.read().slack, null);
    await assert.rejects(
      two.save({ botToken: "xoxb-two", appToken, allowedUserIds: [OWNER] }),
      /already connected to another bot/,
    );
    await one.remove();
    await one.close();
    one = await BotSlack.open(path, app, store, adapters, connections);
    await one.save({ botToken: "xoxb-one", appToken, allowedUserIds: [OWNER] });
    assert.deepEqual(followed.at(-1), []);
  } finally {
    await one.close();
    await two.close();
    await rm(directory, { recursive: true, force: true });
  }
});
