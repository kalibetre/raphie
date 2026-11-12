import { setTimeout as delay } from "node:timers/promises";

export type FetchRequest = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

export type TelegramUser = { id: number; is_bot?: boolean };

export type TelegramChat = { id: number; type: string };

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    data?: string;
    message?: { message_id: number; chat: TelegramChat };
  };
};

/** Carries Telegram's own description only; never a URL, which contains the token. */
export class TelegramApiError extends Error {
  readonly status: number;
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

type Reply = {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export type TelegramApiOptions = {
  /** Tests point this at a local fake. Production always uses Telegram. */
  baseUrl?: string;
  fetch?: FetchRequest;
  timeoutMs?: number;
};

export type OutgoingMessage = {
  chat_id: string;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
};

export function createTelegramApi(
  token: string,
  options: TelegramApiOptions = {},
) {
  const base = options.baseUrl ?? "https://api.telegram.org";
  const request = options.fetch ?? fetch;

  async function call<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    signal?: AbortSignal,
    timeoutMs = options.timeoutMs ?? 20_000,
  ) {
    let response: Response;
    try {
      response = await request(`${base}/bot${token}/${method}`, {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A transport error may embed the request URL, which holds the token.
      throw new TelegramApiError(`Telegram ${method} did not complete.`, 0);
    }
    const reply = (await response.json().catch(() => null)) as Reply | null;
    if (!reply?.ok)
      throw new TelegramApiError(
        reply?.description ?? `Telegram ${method} failed.`,
        reply?.error_code ?? response.status,
        reply?.parameters?.retry_after,
      );
    return reply.result as T;
  }

  return {
    getMe: () =>
      call<{ id: number; username?: string }>("getMe", {}, undefined, 15_000),
    getUpdates: (offset: number, seconds: number, signal: AbortSignal) =>
      call<TelegramUpdate[]>(
        "getUpdates",
        {
          offset,
          timeout: seconds,
          allowed_updates: ["message", "edited_message", "callback_query"],
        },
        signal,
        (seconds + 15) * 1000,
      ),
    sendMessage: (message: OutgoingMessage) =>
      call<{ message_id: number }>("sendMessage", {
        ...message,
        link_preview_options: { is_disabled: true },
      }),
    editMessageText: (message: OutgoingMessage & { message_id: number }) =>
      call<{ message_id: number } | true>("editMessageText", {
        ...message,
        link_preview_options: { is_disabled: true },
      }),
    sendDocument: (
      chatId: string,
      filename: string,
      data: Uint8Array,
      caption?: string,
    ) => {
      const form = new FormData();
      form.set("chat_id", chatId);
      if (caption) form.set("caption", caption);
      form.set("document", new Blob([data as BlobPart]), filename);
      return call<{ message_id: number }>(
        "sendDocument",
        form,
        undefined,
        60_000,
      );
    },
    answerCallbackQuery: (id: string, text: string) =>
      call<true>("answerCallbackQuery", {
        callback_query_id: id,
        text: text.slice(0, 190),
        show_alert: true,
      }),
  };
}

export type TelegramApi = ReturnType<typeof createTelegramApi>;

type Sleep = (ms: number) => Promise<unknown>;

/**
 * Telegram answers 429 before doing any work, so waiting and repeating the
 * same call cannot duplicate a message. Other failures are never retried here.
 */
export async function retryRateLimited<T>(
  work: () => Promise<T>,
  sleep: Sleep = delay,
  attempts = 4,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        !(error instanceof TelegramApiError) ||
        error.status !== 429 ||
        attempt >= attempts
      )
        throw error;
      await sleep(Math.min(Math.max(error.retryAfter ?? 1, 1), 60) * 1000);
    }
  }
}
