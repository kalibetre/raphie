import { setTimeout as delay } from "node:timers/promises";

import type { TelegramUpdate } from "../src/infrastructure/telegram/api.ts";

export type FakeBody = {
  chat_id?: string;
  /** Typed as always present for assertions; only getMe and getUpdates omit it. */
  text: string;
  parse_mode?: string;
  message_id?: number;
  offset?: number;
  reply_markup?: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
};

export type FakeCall = {
  method: string;
  body: FakeBody;
  file?: { name: string; bytes: Uint8Array };
};

/** A local stand-in for the Bot API. No test ever reaches api.telegram.org. */
export class FakeTelegram {
  readonly token = "123456:fixture-token-never-real-0123456789";
  readonly calls: FakeCall[] = [];
  readonly offsets: number[] = [];
  /** Return a response for a call to simulate failures; undefined means succeed. */
  intercept?: (call: FakeCall) => Response | undefined;
  private queue: TelegramUpdate[] = [];
  private updateId = 100;
  private messageId = 1000;
  private readonly server: ReturnType<typeof Bun.serve>;

  constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => this.handle(request),
    });
  }

  get url() {
    return `http://127.0.0.1:${this.server.port}`;
  }

  sent(method = "sendMessage") {
    return this.calls.filter((call) => call.method === method);
  }

  /** Queue an inbound update; returns its update_id. */
  push(update: Omit<TelegramUpdate, "update_id">, id = this.updateId++) {
    this.queue.push({ ...update, update_id: id } as TelegramUpdate);
    return id;
  }

  text(
    userId: number,
    text: string,
    options: { chat?: number; type?: string; id?: number } = {},
  ) {
    return this.push(
      {
        message: {
          message_id: this.messageId++,
          from: { id: userId, is_bot: false },
          chat: { id: options.chat ?? userId, type: options.type ?? "private" },
          text,
        },
      },
      options.id,
    );
  }

  press(userId: number, data: string, messageId = 1, chat = userId) {
    return this.push({
      callback_query: {
        id: `cb-${this.updateId}`,
        from: { id: userId, is_bot: false },
        data,
        message: { message_id: messageId, chat: { id: chat, type: "private" } },
      },
    });
  }

  private async handle(request: Request) {
    // Manual driving of the browser fixture: POST /__text {"user":1,"text":"/pair CODE"}.
    if (new URL(request.url).pathname === "/__text") {
      const input = (await request.json()) as { user: number; text: string };
      return Response.json({ id: this.text(input.user, input.text) });
    }
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(new URL(request.url).pathname);
    if (!match || match[1] !== this.token)
      return Response.json(
        { ok: false, error_code: 401, description: "Unauthorized" },
        { status: 401 },
      );
    const method = match[2]!;
    let body = {} as FakeBody;
    let file: FakeCall["file"];
    if (request.headers.get("content-type")?.startsWith("multipart/")) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        const field: unknown = value;
        if (typeof field === "string") Object.assign(body, { [key]: field });
        else {
          const upload = field as File;
          file = {
            name: upload.name,
            bytes: new Uint8Array(await upload.arrayBuffer()),
          };
        }
      }
    } else body = (await request.json()) as FakeBody;
    const call = { method, body, file };
    if (method !== "getUpdates") this.calls.push(call);
    const forced = this.intercept?.(call);
    if (forced) return forced;
    switch (method) {
      case "getMe":
        return Response.json({
          ok: true,
          result: { id: 123456, username: "raphie_fixture_bot" },
        });
      case "getUpdates": {
        const offset = body.offset ?? 0;
        this.offsets.push(offset);
        this.queue = this.queue.filter((u) => u.update_id >= offset);
        if (!this.queue.length) await delay(15);
        const batch = this.queue.slice(0, 10);
        return Response.json({ ok: true, result: batch });
      }
      case "sendMessage":
      case "sendDocument":
        return Response.json({
          ok: true,
          result: { message_id: this.messageId++ },
        });
      case "editMessageText":
        return Response.json({
          ok: true,
          result: { message_id: body.message_id },
        });
      default:
        return Response.json({ ok: true, result: true });
    }
  }

  async stop() {
    await this.server.stop(true);
  }
}

export function rateLimited(seconds: number) {
  return Response.json(
    {
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry later",
      parameters: { retry_after: seconds },
    },
    { status: 429 },
  );
}
