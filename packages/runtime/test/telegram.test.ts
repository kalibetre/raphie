import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Hono } from "hono";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import type { BotChannels } from "../src/domains/channels/infrastructure/bot-channels.ts";
import {
  BotTelegram,
  TelegramConnections,
} from "../src/domains/channels/infrastructure/bot-telegram.ts";
import { channelRoutes } from "../src/domains/channels/presentation/http/routes.ts";
import type { McpClient } from "../src/infrastructure/mcp/client.ts";
import { createTelegramBridge } from "../src/infrastructure/telegram/bridge.ts";
import { chatModel } from "./chat-model.ts";
import { FakeTelegram } from "./fake-telegram.ts";

const OWNER = 42;
const ARGS = { code: '<b>run</b> & "exactly" this' };

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

function mcp(calls: unknown[]) {
  const client: McpClient = {
    server: { name: "fixture", version: "1" },
    tools: [
      {
        name: "execute",
        description: "Execute",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    call: async (name, args) => {
      calls.push([name, args]);
      return { content: [{ type: "text", text: "done" }] };
    },
    close: async () => {},
  };
  return { client, identity: "fixture" };
}

async function setup(options: { tool?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-telegram-"));
  const fake = new FakeTelegram();
  const calls: unknown[] = [];
  const keys = keyStore();
  const path = join(directory, "telegram.sqlite");
  const open = () =>
    Gateway.open({
      directory,
      ...chatModel(
        options.tool
          ? { tool: { name: "mcp_fixture_execute", args: ARGS } }
          : {},
      ),
      mcp: mcp(calls),
    });
  const telegramOptions = { apiBase: fake.url, pollSeconds: 1, flushMs: 15 };
  const state = {
    directory,
    fake,
    calls,
    path,
    keys,
    app: await open(),
    telegram: undefined as unknown as BotTelegram,
    async reopen() {
      await state.telegram.close();
      await state.app.close();
      state.app = await open();
      state.telegram = await BotTelegram.open(
        path,
        state.app,
        keys,
        telegramOptions,
      );
    },
    async pair(user = OWNER) {
      const { code } = state.telegram.pairingCode();
      fake.text(user, `/pair ${code}`);
      await until(
        () =>
          !!state.telegram
            .read()
            .telegram?.verifiedUserIds.includes(String(user)),
        "pairing",
      );
    },
    async close() {
      await state.telegram.close();
      await state.app.close();
      await fake.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
  state.telegram = await BotTelegram.open(
    path,
    state.app,
    keys,
    telegramOptions,
  );
  await state.telegram.save({ botToken: fake.token });
  return state;
}

const toText = (fake: FakeTelegram, chat = OWNER) =>
  fake
    .sent()
    .filter((call) => call.body.chat_id === String(chat))
    .map((call) => String(call.body.text));

test("only a paired owner can reach the agent; strangers and groups are refused or ignored", async () => {
  const t = await setup();
  try {
    const read = t.telegram.read().telegram!;
    assert.equal(read.botUsername, "raphie_fixture_bot");
    assert.equal(read.connected, true);
    assert.deepEqual(read.verifiedUserIds, []);
    // Unpaired accounts cannot talk to the model, only learn how to pair.
    t.fake.text(7, "hello from a stranger");
    await until(() => toText(t.fake, 7).length === 1, "refusal");
    assert.match(toText(t.fake, 7)[0]!, /private/);
    t.fake.text(7, "again");
    t.fake.text(7, "/pair WRONG-GUESS");
    await until(() => toText(t.fake, 7).length === 2, "wrong code reply");
    assert.match(toText(t.fake, 7)[1]!, /not valid or has expired/);
    t.fake.text(7, "hi", { chat: -1001, type: "supergroup" });
    t.fake.text(7, "hi", { chat: OWNER, type: "private" }); // claimed chat != sender
    await delay(100);
    assert.equal(toText(t.fake, -1001).length, 0, "Groups are ignored");
    assert.equal((await t.app.chats.state()).turns.length, 0);
    // A valid single-use code verifies the immutable user ID, not a username.
    const { code, expiresAt } = t.telegram.pairingCode();
    assert.ok(expiresAt > Date.now());
    t.fake.text(8, `/pair ${code}`);
    await until(
      () => !!t.telegram.read().telegram!.verifiedUserIds.length,
      "pair",
    );
    assert.deepEqual(t.telegram.read().telegram!.verifiedUserIds, ["8"]);
    t.fake.text(9, `/pair ${code}`);
    await until(() => toText(t.fake, 9).length === 1, "reuse reply");
    assert.match(toText(t.fake, 9)[0]!, /not valid/);
    assert.deepEqual(t.telegram.read().telegram!.verifiedUserIds, ["8"]);
    // Revocation takes effect immediately.
    await t.telegram.unpair("8");
    t.fake.text(8, "am I still allowed?");
    await until(
      () => toText(t.fake, 8).some((text) => /private/.test(text)),
      "revoked",
    );
    assert.equal((await t.app.chats.state()).turns.length, 0);
  } finally {
    await t.close();
  }
});

test("a verified owner's message is answered in a chat bound to its own session", async () => {
  const t = await setup();
  try {
    await t.pair();
    t.fake.text(OWNER, "What is on my list?");
    await until(
      () => toText(t.fake).some((text) => /What is on my list/.test(text)),
      "reply",
    );
    const chats = await t.app.chats.state();
    const turn = chats.turns[0]!;
    assert.equal(turn.source, "telegram");
    assert.deepEqual(turn.replyTo, {
      provider: "telegram",
      owner: "owner",
      connectionId: "telegram:123456",
      conversation: `telegram:${OWNER}`,
    });
    // The same chat continues the same session; no other chat sees it.
    t.fake.text(OWNER, "And tomorrow?");
    await until(
      () => toText(t.fake).some((text) => /And tomorrow/.test(text)),
      "second reply",
    );
    assert.equal((await t.app.chats.state()).conversations.length, 1);
    await until(async () =>
      (await t.app.chats.state()).deliveries.every((d) => d.status === "sent"),
    );
  } finally {
    await t.close();
  }
});

test("unsupported input gets an explicit answer instead of being dropped", async () => {
  const t = await setup();
  try {
    await t.pair();
    t.fake.push({
      message: {
        message_id: 5,
        from: { id: OWNER, is_bot: false },
        chat: { id: OWNER, type: "private" },
      },
    });
    t.fake.text(OWNER, "/copy something");
    t.fake.push({
      edited_message: {
        message_id: 5,
        from: { id: OWNER, is_bot: false },
        chat: { id: OWNER, type: "private" },
        text: "edited",
      },
    });
    t.fake.text(OWNER, "/start");
    await until(() => toText(t.fake).length >= 5, "notices");
    const notices = toText(t.fake).slice(1).join("\n");
    assert.match(notices, /only read text/);
    assert.match(notices, /\/copy\) are not supported/);
    assert.match(notices, /Edited messages are not applied/);
    assert.match(notices, /Not supported in Telegram/);
    assert.equal((await t.app.chats.state()).turns.length, 0);
  } finally {
    await t.close();
  }
});

test("message → approval → exact tool execution → reply, with no web process; stale presses never repeat it", async () => {
  const t = await setup({ tool: true });
  try {
    await t.pair();
    t.fake.text(OWNER, "run the tool");
    await until(
      async () => (await t.app.toolApprovals.state()).approvals.length === 1,
      "approval",
    );
    const approval = (await t.app.toolApprovals.state()).approvals[0]!;
    assert.deepEqual(JSON.parse(approval.argumentsJson), ARGS);
    await until(
      () => t.fake.sent().some((call) => call.body.reply_markup),
      "approval card",
    );
    const card = t.fake.sent().find((call) => call.body.reply_markup)!;
    assert.equal(card.body.parse_mode, "HTML");
    assert.match(card.body.text, /&lt;b&gt;run&lt;\/b&gt; &amp;/);
    const [approve, decline] = card.body.reply_markup!.inline_keyboard[0]!;
    assert.equal(approve!.callback_data, `ta:${approval.id}`);
    assert.equal(decline!.callback_data, `tr:${approval.id}`);
    assert.equal(t.calls.length, 0, "Nothing runs before a decision");
    // A stranger, a group chat and a forged action change nothing.
    t.fake.press(99, approve!.callback_data);
    t.fake.press(OWNER, approve!.callback_data, 1, -1001);
    t.fake.press(OWNER, `ta:not-a-request`);
    await until(
      () => t.fake.sent("answerCallbackQuery").length === 3,
      "answers",
    );
    assert.equal(t.calls.length, 0);
    assert.equal(
      (await t.app.toolApprovals.state()).approvals[0]!.status,
      "pending",
    );
    // The verified owner approves; the exact arguments execute once and the model replies.
    t.fake.press(OWNER, approve!.callback_data);
    await until(() => t.calls.length === 1, "execution");
    assert.deepEqual(t.calls, [["execute", ARGS]]);
    await until(() => toText(t.fake).some((text) => text === "done"), "reply");
    await until(
      () =>
        t.fake
          .sent("editMessageText")
          .some((call) => /approved/.test(call.body.text)),
      "card edit",
    );
    const edit = t.fake.sent("editMessageText")[0]!;
    assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] });
    // Duplicate and opposite presses of the same buttons are answered, never executed again.
    t.fake.press(OWNER, approve!.callback_data);
    t.fake.press(OWNER, decline!.callback_data);
    await until(
      () => t.fake.sent("answerCallbackQuery").length === 6,
      "stale answers",
    );
    assert.equal(
      t.fake.sent("answerCallbackQuery").at(-1)!.body.text,
      "Request approved.",
    );
    await delay(100);
    assert.equal(t.calls.length, 1);
    const settled = (await t.app.toolApprovals.state()).approvals[0]!;
    assert.equal(settled.status, "approved");
    assert.equal(settled.decidedVia, "telegram");
  } finally {
    await t.close();
  }
});

test("a web decision settles a Telegram-origin approval and later presses cannot run it", async () => {
  const t = await setup({ tool: true });
  try {
    await t.pair();
    t.fake.text(OWNER, "run the tool");
    await until(
      async () => (await t.app.toolApprovals.state()).approvals.length === 1,
      "approval",
    );
    await until(
      () => t.fake.sent().some((call) => call.body.reply_markup),
      "card",
    );
    const approval = (await t.app.toolApprovals.state()).approvals[0]!;
    assert.equal(
      await t.app.sessions.decide(
        t.app.actors.establish("web"),
        approval.id,
        "rejected",
      ),
      "rejected",
    );
    await until(
      () =>
        t.fake
          .sent("editMessageText")
          .some((call) => /rejected/.test(call.body.text)),
      "edit",
    );
    t.fake.press(OWNER, `ta:${approval.id}`);
    await until(
      () => t.fake.sent("answerCallbackQuery").length === 1,
      "answer",
    );
    assert.equal(
      t.fake.sent("answerCallbackQuery")[0]!.body.text,
      "Request rejected.",
    );
    assert.equal(t.calls.length, 0);
  } finally {
    await t.close();
  }
});

test("only the initiating verified user can decide; a second owner cannot", async () => {
  const t = await setup({ tool: true });
  try {
    await t.pair();
    await t.pair(43);
    t.fake.text(OWNER, "run the tool");
    await until(
      async () => (await t.app.toolApprovals.state()).approvals.length === 1,
      "approval",
    );
    const id = (await t.app.toolApprovals.state()).approvals[0]!.id;
    t.fake.press(43, `ta:${id}`, 1, 43);
    await until(
      () => t.fake.sent("answerCallbackQuery").length === 1,
      "answer",
    );
    assert.match(
      t.fake.sent("answerCallbackQuery")[0]!.body.text,
      /belongs to another Telegram chat/,
    );
    assert.equal(t.calls.length, 0);
  } finally {
    await t.close();
  }
});

test("scheduled turns never deliver to Telegram, even in a Telegram-bound session", async () => {
  const t = await setup();
  try {
    await t.pair();
    t.fake.text(OWNER, "first");
    await until(
      () => toText(t.fake).some((text) => /first/.test(text)),
      "reply",
    );
    const session = (await t.app.chats.state()).conversations[0]!.sessionId;
    await t.app.sessions.submitScheduled(t.app.actors.establish("web"), {
      eventId: "job-run",
      text: "scheduled work",
      sessionId: session,
      scheduled: { name: "Daily" },
    });
    await until(
      async () =>
        (await t.app.chats.state()).turns.every(
          (turn) => turn.status === "done",
        ),
      "scheduled turn",
    );
    await delay(100);
    const chats = await t.app.chats.state();
    assert.equal(chats.turns.at(-1)!.replyTo, null);
    assert.equal(chats.deliveries.length, 1);
    assert.equal(
      toText(t.fake).filter((text) => /scheduled work/.test(text)).length,
      0,
    );
  } finally {
    await t.close();
  }
});

test("updates are deduplicated and polling resumes from the persisted offset after restart", async () => {
  const t = await setup();
  try {
    await t.pair();
    const id = t.fake.text(OWNER, "only once", { id: 500 });
    await until(
      () => toText(t.fake).some((text) => /only once/.test(text)),
      "reply",
    );
    await until(() => t.fake.offsets.at(-1) === id + 1, "offset commit");
    await t.reopen();
    // Telegram redelivers an unconfirmed update; neither layer reprocesses it.
    t.fake.text(OWNER, "only once", { id: 500 });
    t.fake.text(OWNER, "next one", { id: 501 });
    await until(
      () => toText(t.fake).some((text) => /next one/.test(text)),
      "next reply",
    );
    assert.ok(
      t.fake.offsets.includes(501),
      "Polling resumed from the saved offset",
    );
    assert.ok(!t.fake.offsets.slice(-5).includes(0), "No restart from zero");
    const turns = (await t.app.chats.state()).turns;
    assert.deepEqual(
      turns.map((turn) => turn.text),
      ["only once", "next one"],
    );
    assert.equal(t.telegram.read().telegram!.verifiedUserIds[0], String(OWNER));
  } finally {
    await t.close();
  }
});

test("a crash between admission and the offset commit cannot admit the message twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-telegram-dedupe-"));
  const fake = new FakeTelegram();
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const advanced: number[] = [];
    const bridge = createTelegramBridge(app, {
      token: fake.token,
      botId: "123456",
      apiBase: fake.url,
      owners: () => [String(OWNER)],
      pair: () => false,
      cursor: { next: () => 0, advance: (id) => void advanced.push(id) },
    });
    const update = {
      update_id: 900,
      message: {
        message_id: 1,
        from: { id: OWNER, is_bot: false },
        chat: { id: OWNER, type: "private" },
        text: "exactly one turn",
      },
    };
    await bridge.handleUpdate(update);
    await bridge.handleUpdate(update);
    assert.equal((await app.chats.state()).turns.length, 1);
  } finally {
    await app.close();
    await fake.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a long reply is chunked below 4096 characters and sent in order", async () => {
  const t = await setup();
  try {
    await t.pair();
    const text = `${"lorem ipsum ".repeat(300)}`.trim();
    t.fake.text(OWNER, text);
    await until(
      async () =>
        (await t.app.chats.state()).deliveries.length === 1 &&
        (await t.app.chats.state()).deliveries[0]!.status === "sent",
      "delivery",
    );
    const parts = toText(t.fake).filter((part) => part.startsWith("lorem"));
    assert.ok(parts.length >= 1);
    for (const part of toText(t.fake)) assert.ok(part.length <= 4096);
    assert.equal(parts.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  } finally {
    await t.close();
  }
});

test("a rate-limited send waits retry_after and still delivers exactly one reply", async () => {
  const slept: number[] = [];
  const directory = await mkdtemp(join(tmpdir(), "raphie-telegram-429-"));
  const fake = new FakeTelegram();
  const app = await Gateway.open({ directory, ...chatModel() });
  const telegram = await BotTelegram.open(
    join(directory, "t.sqlite"),
    app,
    keyStore(),
    {
      apiBase: fake.url,
      pollSeconds: 1,
      flushMs: 15,
      sleep: async (ms) => {
        slept.push(ms);
        await delay(1);
      },
    },
  );
  try {
    await telegram.save({ botToken: fake.token });
    const { code } = telegram.pairingCode();
    fake.text(OWNER, `/pair ${code}`);
    await until(
      () => telegram.read().telegram!.verifiedUserIds.length === 1,
      "pair",
    );
    let limited = 2;
    fake.intercept = (call) =>
      call.method === "sendMessage" &&
      /limited/.test(String(call.body.text)) &&
      limited-- > 0
        ? Response.json(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests",
              parameters: { retry_after: 7 },
            },
            { status: 429 },
          )
        : undefined;
    fake.text(OWNER, "limited");
    await until(
      async () => (await app.chats.state()).deliveries[0]?.status === "sent",
      "delivery",
    );
    assert.equal(toText(fake).filter((text) => /limited/.test(text)).length, 3);
    assert.ok(slept.filter((ms) => ms === 7000).length >= 2);
    const plan = (await app.chats.state()).deliveries[0]!;
    assert.equal(plan.status, "sent");
  } finally {
    await telegram.close();
    await app.close();
    await fake.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a lost send is uncertain and never repeated", async () => {
  const t = await setup();
  try {
    await t.pair();
    t.fake.intercept = (call) =>
      call.method === "sendMessage" && /lost/.test(String(call.body.text))
        ? new Response("gateway error", { status: 502 })
        : undefined;
    t.fake.text(OWNER, "lost");
    await until(
      async () =>
        (await t.app.chats.state()).deliveries[0]?.status === "uncertain",
      "uncertain",
    );
    await delay(100);
    assert.equal(toText(t.fake).filter((text) => /lost/.test(text)).length, 1);
  } finally {
    await t.close();
  }
});

test("the token is stored encrypted, restored after restart, never returned, and removal clears it", async () => {
  const t = await setup();
  try {
    assert.equal(
      JSON.stringify(t.telegram.read()).includes(t.fake.token),
      false,
    );
    assert.equal((await readFile(t.path)).includes(t.fake.token), false);
    await t.pair();
    await t.reopen();
    const read = t.telegram.read().telegram!;
    assert.equal(read.connected, true);
    assert.deepEqual(read.verifiedUserIds, [String(OWNER)]);
    // Disabling stops polling but keeps the connection; the token is kept.
    assert.equal(
      (await t.telegram.save({ enabled: false })).telegram!.connected,
      false,
    );
    assert.throws(() => t.telegram.pairingCode(), /Enable and connect/);
    assert.equal(
      (await t.telegram.save({ enabled: true })).telegram!.connected,
      true,
    );
    assert.equal((await t.telegram.remove()).telegram, null);
    assert.equal(t.telegram.read().telegram, null);
  } finally {
    await t.close();
  }
});

test("a Telegram bot connects to one Raphie bot at a time and bad tokens are rejected", async () => {
  const t = await setup();
  const connections = new TelegramConnections();
  const first = await BotTelegram.open(
    join(t.directory, "a.sqlite"),
    t.app,
    t.keys,
    { apiBase: t.fake.url, pollSeconds: 1 },
    connections,
  );
  const second = await BotTelegram.open(
    join(t.directory, "b.sqlite"),
    t.app,
    t.keys,
    { apiBase: t.fake.url, pollSeconds: 1 },
    connections,
  );
  try {
    await first.save({ botToken: t.fake.token });
    await assert.rejects(
      second.save({ botToken: t.fake.token }),
      /already connected to another/,
    );
    await assert.rejects(
      second.save({ botToken: "999:wrong-token-wrong-token-0000" }),
      /Telegram connection failed/,
    );
    assert.equal(second.read().telegram, null);
    await first.remove();
    await second.save({ botToken: t.fake.token });
    assert.equal(second.read().telegram!.connected, true);
  } finally {
    await first.close();
    await second.close();
    await t.close();
  }
});

test("settings routes never return the token and validate input", async () => {
  const t = await setup();
  try {
    const channels = {
      read: () => ({ discord: null }),
    } as unknown as BotChannels;
    const app = new Hono().route(
      "/api/channels",
      channelRoutes(channels, t.telegram),
    );
    const post = (path: string, body: unknown) =>
      app.request(`/api/channels${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/telegram", { botToken: "not a token" })).status,
      400,
    );
    assert.equal(
      (await post("/telegram", { botToken: t.fake.token, extra: 1 })).status,
      400,
    );
    const saved = await post("/telegram", { botToken: t.fake.token });
    assert.equal(saved.status, 200);
    const pairing = await (await post("/telegram/pairing", {})).json();
    assert.match(pairing.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const listed = await (await app.request("/api/channels")).text();
    assert.equal(listed.includes(t.fake.token), false);
    assert.equal(
      listed.includes(pairing.code),
      false,
      "A code is shown once, never listed",
    );
    assert.equal(JSON.parse(listed).telegram.botUsername, "raphie_fixture_bot");
    assert.equal(
      (await post("/telegram/unpair", { userId: "abc" })).status,
      400,
    );
  } finally {
    await t.close();
  }
});

test("Telegram actors cannot use the file-copy experiment or inspection reads", async () => {
  const t = await setup();
  try {
    const actor = t.app.actors.establish(
      "telegram",
      "telegram:42",
      "telegram:123456",
      "42",
    );
    await assert.rejects(
      t.app.sessions.copy(actor, { eventId: "x", text: "copy", files: [] }),
      /not available in Telegram/,
    );
    await assert.rejects(t.app.queries.info(actor), /client interface/);
    assert.throws(
      () => t.app.actors.establish("telegram"),
      /verified conversation/,
    );
  } finally {
    await t.close();
  }
});
