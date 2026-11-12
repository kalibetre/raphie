import { setTimeout as delay } from "node:timers/promises";

import type { TelegramProblem } from "@raphie/contracts";

import type { ChannelServices } from "../../application/channels/ports.ts";
import { createDeliveryWorker } from "../../domains/delivery/application/worker.ts";
import { InputError } from "../../shared/application/input-error.ts";
import {
  createTelegramApi,
  type FetchRequest,
  retryRateLimited,
  TelegramApiError,
  type TelegramMessage,
  type TelegramUpdate,
} from "./api.ts";
import {
  APPROVE,
  decodeTelegramOperation,
  REJECT,
  sendTelegramOperation,
  telegramRenderer,
} from "./delivery.ts";

export type TelegramBridgeConfig = {
  token: string;
  botId: string;
  /** Tests only; production always talks to api.telegram.org. */
  apiBase?: string;
  fetch?: FetchRequest;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  pollSeconds?: number;
  /** Verified Telegram user IDs, read on every update so revocation is immediate. */
  owners(): string[];
  /** Consumes a pairing code and records the user when it is valid. */
  pair(userId: string, code: string): boolean;
  /** Next getUpdates offset, durable across restarts. */
  cursor: { next(): number; advance(updateId: number): void };
  onProblem?(problem: TelegramProblem | null): void;
};

const HELP =
  "I am a private assistant. Send me a message to start a conversation. Tool actions will arrive with Approve and Decline buttons.\n\nNot supported in Telegram: photos, files and other attachments, group chats, edited messages, Markdown formatting and the /copy command.";
const STRANGER =
  "This assistant is private. If you are its owner, open Raphie Settings → Channels → Telegram, create a pairing code, then send /pair followed by the code here.";
const REFUSAL_INTERVAL_MS = 10 * 60 * 1000;

export function createTelegramBridge(
  app: ChannelServices,
  config: TelegramBridgeConfig,
) {
  const connectionId = `telegram:${config.botId}`;
  const api = createTelegramApi(config.token, {
    baseUrl: config.apiBase,
    fetch: config.fetch,
  });
  const sleep =
    config.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const refused = new Map<string, number>();

  /** Best-effort notices never throw: they are not durable deliveries. */
  async function notify(chatId: number | string, text: string) {
    await retryRateLimited(
      () => api.sendMessage({ chat_id: String(chatId), text }),
      sleep,
    ).catch(() => console.error("Telegram notice failed."));
  }

  const actor = (chatId: number, userId: number) =>
    app.actors.establish(
      "telegram",
      `telegram:${chatId}`,
      connectionId,
      String(userId),
    );

  async function handleMessage(updateId: number, message: TelegramMessage) {
    // Only a verified owner's private chat can ever reach the agent.
    const from = message.from;
    if (
      message.chat.type !== "private" ||
      !from ||
      from.is_bot ||
      from.id !== message.chat.id
    )
      return;
    const chatId = message.chat.id;
    const command = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(
      message.text?.trim() ?? "",
    );
    if (command?.[1] === "pair") {
      if (config.owners().includes(String(from.id)))
        return notify(chatId, "This Telegram account is already verified.");
      return notify(
        chatId,
        config.pair(String(from.id), command[2] ?? "")
          ? "Verified. You can now chat with this assistant here."
          : "That pairing code is not valid or has expired. Create a new one in Raphie Settings.",
      );
    }
    if (!config.owners().includes(String(from.id))) {
      const last = refused.get(String(chatId)) ?? 0;
      if (Date.now() - last < REFUSAL_INTERVAL_MS) return;
      refused.set(String(chatId), Date.now());
      return notify(chatId, STRANGER);
    }
    if (command?.[1] === "start" || command?.[1] === "help")
      return notify(chatId, HELP);
    if (command?.[1] === "copy")
      return notify(
        chatId,
        "File approvals (/copy) are not supported in Telegram. Use the web workspace.",
      );
    if (message.text === undefined)
      return notify(
        chatId,
        "I can only read text in Telegram. Photos, files, voice and other attachments are not supported.",
      );
    try {
      await app.sessions.submit(actor(chatId, from.id), {
        eventId: `${config.botId}:${updateId}`,
        text: message.text,
      });
    } catch (error) {
      await notify(
        chatId,
        error instanceof InputError
          ? error.message
          : "I could not accept that message. Please try again.",
      );
    }
  }

  async function handleCallback(
    callback: NonNullable<TelegramUpdate["callback_query"]>,
  ) {
    const answer = (text: string) =>
      retryRateLimited(
        () => api.answerCallbackQuery(callback.id, text),
        sleep,
      ).catch(() => console.error("Telegram callback answer failed."));
    const chat = callback.message?.chat;
    if (
      callback.from.is_bot ||
      !config.owners().includes(String(callback.from.id))
    )
      return answer("You are not authorized to decide this request.");
    const approve = callback.data?.startsWith(APPROVE);
    if (
      !chat ||
      chat.type !== "private" ||
      chat.id !== callback.from.id ||
      (!approve && !callback.data?.startsWith(REJECT))
    )
      return answer("This action is not supported.");
    try {
      // Settled requests keep their first decision; a repeat press cannot run the tool again.
      const status = await app.sessions.decide(
        actor(chat.id, callback.from.id),
        callback.data!.slice(3),
        approve ? "approved" : "rejected",
      );
      await answer(`Request ${status}.`);
    } catch (error) {
      await answer(
        error instanceof InputError
          ? error.message
          : "I could not record that decision.",
      );
    }
  }

  /** Never throws, so one bad update cannot stall the offset. */
  async function handleUpdate(update: TelegramUpdate) {
    try {
      if (update.callback_query) await handleCallback(update.callback_query);
      else if (update.message)
        await handleMessage(update.update_id, update.message);
      else if (update.edited_message) {
        const edited = update.edited_message;
        if (
          edited.chat.type === "private" &&
          config.owners().includes(String(edited.from?.id))
        )
          await notify(
            edited.chat.id,
            "Edited messages are not applied. Send a new message instead.",
          );
      }
    } catch {
      console.error("Telegram update failed.");
    }
  }

  function problem(error: unknown): TelegramProblem {
    if (error instanceof TelegramApiError) {
      if (error.status === 401 || error.status === 404) return "token";
      if (error.status === 409) return "conflict";
    }
    return "network";
  }

  /** Long polling: each update is handled, then its offset is committed. */
  async function poll(signal: AbortSignal) {
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        const updates = await api.getUpdates(
          config.cursor.next(),
          config.pollSeconds ?? 30,
          signal,
        );
        config.onProblem?.(null);
        backoff = 1000;
        for (const update of updates) {
          // Unhandled updates stay uncommitted and are delivered again later.
          if (signal.aborted) return;
          if (update.update_id < config.cursor.next()) continue;
          await handleUpdate(update);
          config.cursor.advance(update.update_id);
        }
      } catch (error) {
        if (signal.aborted) return;
        config.onProblem?.(problem(error));
        const wait =
          error instanceof TelegramApiError && error.status === 429
            ? (error.retryAfter ?? 1) * 1000
            : backoff;
        backoff = Math.min(backoff * 2, 30_000);
        await sleep(wait, signal).catch(() => {});
      }
    }
  }

  const flush = createDeliveryWorker(
    app.deliveries.forConnection(connectionId),
    telegramRenderer(),
    (payload) =>
      sendTelegramOperation(api, decodeTelegramOperation(payload), sleep),
    app.telemetry,
  );

  return { connectionId, flush, poll, handleUpdate };
}
