import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import type { ToolApproval } from "../src/domains/approvals/domain/tool-approval.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { createDeliveryWorker } from "../src/domains/delivery/application/worker.ts";
import { DeliveryPlans } from "../src/domains/delivery/infrastructure/pi-delivery-queue.ts";
import { createTelegramApi } from "../src/infrastructure/telegram/api.ts";
import {
  chunkText,
  decodeTelegramOperation,
  escapeHtml,
  sendTelegramOperation,
  telegramRenderer,
} from "../src/infrastructure/telegram/delivery.ts";
import { PairingCodes } from "../src/infrastructure/telegram/pairing.ts";
import { FakeTelegram, rateLimited } from "./fake-telegram.ts";

const approval = (argumentsJson: string): ToolApproval => ({
  id: "approval-1",
  taskId: 1,
  conversationId: 1,
  fingerprint: "f",
  server: "fixture",
  tool: "execute",
  argumentsJson,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  status: "pending",
  decidedVia: null,
  execution: "waiting",
  result: null,
});

async function render(
  intent: Parameters<ReturnType<typeof telegramRenderer>>[0],
) {
  return (await telegramRenderer()(intent)).map(decodeTelegramOperation);
}

test("chunking stays under Telegram's limit, keeps every character and never splits a surrogate pair", () => {
  const text = `${"word ".repeat(1200)}\n\n${"😀".repeat(3000)}${"y".repeat(9000)}`;
  const parts = chunkText(text);
  assert.equal(parts.join(""), text);
  for (const part of parts) {
    assert.ok(part.length <= 4096);
    assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  }
  assert.deepEqual(chunkText("short"), ["short"]);
});

test("HTML cards escape every dynamic value and keep the exact arguments", async () => {
  const args = JSON.stringify({ code: '<img src=x onerror="a&b">' });
  const [card, ...rest] = await render({
    id: "d",
    threadId: "telegram:42",
    source: "tool",
    kind: "approval",
    approval: { ...approval(args), tool: "ex<ecute>" },
    originalMessageId: null,
  });
  assert.equal(rest.length, 0);
  assert.equal(card!.chatId, "42");
  assert.equal(card!.html, true);
  assert.match(card!.text, /&lt;img src=x onerror=\\"a&amp;b\\"&gt;/);
  assert.match(card!.text, /ex&lt;ecute&gt;/);
  assert.doesNotMatch(card!.text, /<img/);
  assert.deepEqual(
    card!.buttons?.map((button) => button.data),
    ["ta:approval-1", "tr:approval-1"],
  );
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});

test("oversized arguments are truncated in the card and attached whole, within the message limit", async () => {
  const args = JSON.stringify({ code: "<&>".repeat(6000) });
  const [card, file] = await render({
    id: "d",
    threadId: "telegram:42",
    source: "tool",
    kind: "approval",
    approval: approval(args),
    originalMessageId: null,
  });
  assert.ok(card!.text.length <= 4096);
  assert.match(card!.text, /follows in the next message/);
  assert.ok(card!.buttons);
  assert.deepEqual(
    JSON.parse(Buffer.from(file!.document!.base64, "base64").toString()),
    JSON.parse(args),
  );
});

test("a settled request is re-rendered without buttons as an edit of its original message", async () => {
  const [edit] = await render({
    id: "d",
    threadId: "telegram:42",
    source: "tool",
    kind: "resolved",
    approval: { ...approval("{}"), status: "approved" },
    originalMessageId: "777",
  });
  assert.equal(edit!.messageId, "777");
  assert.equal(edit!.buttons, undefined);
  assert.match(edit!.text, /Tool request approved/);
});

test("file approvals get an explicit unsupported notice instead of being dropped", async () => {
  const [notice] = await render({
    id: "d",
    threadId: "telegram:42",
    source: "file",
    kind: "approval",
    approval: {} as never,
    originalMessageId: null,
  });
  assert.match(notice!.text, /not supported in Telegram/);
});

test("429 replies wait retry_after and repeat the same call; other failures are not retried", async () => {
  const fake = new FakeTelegram();
  try {
    const api = createTelegramApi(fake.token, { baseUrl: fake.url });
    const slept: number[] = [];
    let limited = 2;
    fake.intercept = (call) =>
      call.method === "sendMessage" && limited-- > 0
        ? rateLimited(3)
        : undefined;
    const id = await sendTelegramOperation(
      api,
      { chatId: "42", text: "hello" },
      async (ms) => {
        slept.push(ms);
      },
    );
    assert.equal(fake.sent().length, 3);
    assert.deepEqual(slept, [3000, 3000]);
    assert.match(id, /^\d+$/);
    fake.calls.length = 0;
    fake.intercept = () => new Response("boom", { status: 500 });
    await assert.rejects(
      sendTelegramOperation(api, { chatId: "42", text: "hello" }),
      /sendMessage failed/,
    );
    assert.equal(
      fake.sent().length,
      1,
      "An unknown outcome must not be repeated",
    );
  } finally {
    await fake.stop();
  }
});

test("an edit that changes nothing counts as delivered", async () => {
  const fake = new FakeTelegram();
  try {
    fake.intercept = () =>
      Response.json(
        {
          ok: false,
          error_code: 400,
          description: "Bad Request: message is not modified",
        },
        { status: 400 },
      );
    const id = await sendTelegramOperation(
      createTelegramApi(fake.token, { baseUrl: fake.url }),
      { chatId: "42", text: "same", messageId: "9" },
    );
    assert.equal(id, "9");
  } finally {
    await fake.stop();
  }
});

test("a network failure never leaks the token", async () => {
  const api = createTelegramApi("111:secret-token-value-0000000000", {
    fetch: async (input) => {
      throw new Error(
        `connect failed for ${input instanceof Request ? input.url : input.toString()}`,
      );
    },
  });
  const error = await api.getMe().catch((cause: Error) => cause);
  assert.ok(error instanceof Error);
  assert.doesNotMatch(error.message, /secret-token/);
});

test("pairing codes are single use, expire, and die after five wrong guesses", () => {
  const codes = new PairingCodes();
  const now = 1_000_000;
  const { code, expiresAt } = codes.issue(now);
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(expiresAt, now + 600_000);
  assert.equal(codes.consume("WRONG-WRONG", now), false);
  assert.equal(codes.consume(code.toLowerCase().replace("-", " "), now), true);
  assert.equal(codes.consume(code, now), false, "A code works only once");
  const second = codes.issue(now);
  assert.equal(codes.consume(second.code, now + 600_001), false);
  const third = codes.issue(now);
  for (let n = 0; n < 5; n++) codes.consume("AAAAA-AAAAA", now);
  assert.equal(codes.consume(third.code, now), false);
  expect(codes.expiresAt(now)).toBeNull();
});

for (const acknowledged of [true, false])
  test(`Telegram delivery recovers after SIGKILL with first chunk ${acknowledged ? "confirmed" : "uncertain"}`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "raphie-telegram-delivery-"),
    );
    let app = await Gateway.open({ directory });
    try {
      await app.root.commit(async (tx) => {
        (await tx.doc(Chats)).deliveries.push({
          id: "original-id",
          turnId: "turn",
          threadId: "telegram:42",
          connectionId: "telegram:1",
          text: "x".repeat(9000),
          status: "pending",
        });
      }, context);
      await app.close();
      const child = Bun.spawn(
        [
          process.execPath,
          new URL("./telegram-delivery-worker.ts", import.meta.url).pathname,
          directory,
          String(acknowledged),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      try {
        const reader = child.stdout.getReader();
        const ready = await reader.read();
        assert.equal(
          new TextDecoder().decode(ready.value).trim(),
          "first-chunk",
        );
        child.kill("SIGKILL");
        await child.exited;
        reader.releaseLock();
      } finally {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await child.exited;
        }
      }
      app = await Gateway.open({ directory });
      const fake = new FakeTelegram();
      try {
        const api = createTelegramApi(fake.token, { baseUrl: fake.url });
        await createDeliveryWorker(
          app.deliveries.forConnection("telegram:1"),
          telegramRenderer(),
          (payload) =>
            sendTelegramOperation(api, decodeTelegramOperation(payload)),
        )();
        const plan = (await app.harness.snapshot(DeliveryPlans, context))!
          .plans[0]!;
        assert.equal(plan.operations.length, 3);
        assert.equal(
          fake.sent().length,
          2,
          "First chunk must never be sent again",
        );
        assert.deepEqual(
          plan.operations.map((op) => op.status),
          [acknowledged ? "sent" : "uncertain", "sent", "sent"],
        );
        assert.equal(
          plan.operations[0]!.messageId,
          acknowledged ? "platform-first" : null,
        );
        assert.equal(
          (await app.chats.state()).deliveries[0]!.status,
          acknowledged ? "sent" : "uncertain",
        );
      } finally {
        await fake.stop();
      }
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("a Telegram worker cannot claim Discord intents, nor another Telegram bot's", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-telegram-scope-"));
  const app = await Gateway.open({ directory });
  try {
    await app.root.commit(async (tx) => {
      (await tx.doc(Chats)).deliveries.push({
        id: "scoped",
        turnId: "turn",
        threadId: "discord:guild:channel",
        connectionId: "123456",
        text: "hi",
        status: "pending",
      });
    }, context);
    for (const id of ["telegram:123456", "telegram:2"])
      assert.equal(
        await app.deliveries.forConnection(id).claim(telegramRenderer()),
        null,
      );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Telegram renderer never exposes tool cards, arguments or documents to groups", async () => {
  const parts = await render({
    id: "group-approval",
    threadId: "telegram:-1001",
    source: "tool",
    kind: "approval",
    approval: approval(JSON.stringify({ secretAction: "private-arguments" })),
    originalMessageId: null,
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.chatId, "-1001");
  assert.match(parts[0]!.text, /web workspace/);
  assert.ok(!JSON.stringify(parts).includes("private-arguments"));
  assert.equal(parts[0]!.buttons, undefined);
  assert.equal(parts[0]!.document, undefined);
});
