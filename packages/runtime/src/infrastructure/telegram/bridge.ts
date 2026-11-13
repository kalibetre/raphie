import { setTimeout as delay } from "node:timers/promises";

import type { TelegramProblem } from "@raphie/contracts";

import type { ChannelServices } from "../../application/channels/ports.ts";
import { createDeliveryWorker } from "../../domains/delivery/application/worker.ts";
import { InputError } from "../../shared/application/input-error.ts";
import { groupMessageText } from "./addressing.ts";
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
  botUsername: string;
  groupSeen(chatId: string): void;
  groupRemoved(chatId: string): void;
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

const COMMANDS = [
  { command: "ask", description: "Ask this assistant a question" },
  {
    command: "pair",
    description: "Verify your account with a code from Raphie Settings",
  },
  {
    command: "home",
    description: "Use this conversation for scheduled updates",
  },
  { command: "help", description: "Show help and supported capabilities" },
  { command: "start", description: "Start using this private assistant" },
];

const HELP =
  "I am a private assistant. Send me a message to start a conversation. Tool actions will arrive with Approve and Decline buttons. Use /home to send scheduled updates here. In groups, verified owners must @mention me or use /ask@BotName. Group tool approvals are web-only.\n\nNot supported in Telegram: photos, files and other attachments, broadcast channels, forum topics, edited messages, Markdown formatting and the /copy command.";
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
  async function notify(
    chatId: number | string,
    text: string,
    threadId?: number,
  ) {
    await retryRateLimited(
      () =>
        api.sendMessage({
          chat_id: String(chatId),
          text,
          ...(threadId ? { message_thread_id: threadId } : {}),
        }),
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

  async function handleMessage(
    updateId: number,
    message: TelegramMessage,
    edited = false,
  ) {
    const from = message.from;
    const privateChat = message.chat.type === "private";
    const group =
      message.chat.type === "group" || message.chat.type === "supergroup";
    if (
      !from ||
      from.is_bot ||
      message.sender_chat ||
      !Number.isSafeInteger(from.id) ||
      from.id <= 0 ||
      !Number.isSafeInteger(message.chat.id)
    )
      return;
    if (
      privateChat ? from.id !== message.chat.id : !group || message.chat.id >= 0
    )
      return;
    const chatId = message.chat.id;
    const verified = config.owners().includes(String(from.id));
    // Groups never enroll accounts or consume pairing codes. No unverified group text reaches the model.
    if (group && !verified) return;
    const text = group
      ? groupMessageText(message, config.botUsername)
      : message.text;
    if (group && text === null) return;
    const notifyHere = (reply: string) =>
      notify(chatId, reply, message.message_thread_id);
    if (group && message.message_thread_id !== undefined)
      return notifyHere(
        "Forum topics are not supported yet. Use a regular group or a private chat.",
      );
    if (group && message.text === undefined)
      return notifyHere(
        "I can only read text in Telegram. Photos, files, voice and other attachments are not supported.",
      );
    const command = /^\/(\w+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(
      text?.trim() ?? "",
    );
    if (
      command?.[2] &&
      command[2].toLowerCase() !== config.botUsername.toLowerCase()
    )
      return;
    if (edited) {
      if (verified)
        await notifyHere(
          "Edited messages are not applied. Send a new message instead.",
        );
      return;
    }
    if (command?.[1] === "pair") {
      if (group)
        return notifyHere(
          "Pair your account in a private chat with this bot. Never post pairing codes in a group.",
        );
      if (verified)
        return notifyHere("This Telegram account is already verified.");
      if (!command[3]?.trim())
        return notifyHere(
          "Open Raphie Settings → Channels → Telegram, create a pairing code, then send /pair followed by that code here.",
        );
      return notifyHere(
        config.pair(String(from.id), command[3])
          ? "Verified. You can now chat with this assistant here."
          : "That pairing code is not valid or has expired. Create a new one in Raphie Settings.",
      );
    }
    if (!verified) {
      const last = refused.get(String(chatId)) ?? 0;
      if (Date.now() - last < REFUSAL_INTERVAL_MS) return;
      refused.set(String(chatId), Date.now());
      return notifyHere(STRANGER);
    }
    if (group) config.groupSeen(String(chatId));
    if (command?.[1] === "home") {
      await app.home.setCurrent(actor(chatId, from.id), String(updateId));
      return notifyHere(
        group
          ? "This group is now this bot’s home. Scheduled updates from every job will be visible to everyone here. Tool approvals stay in the web workspace."
          : "This conversation is now this bot’s home for scheduled updates.",
      );
    }
    if (command?.[1] === "start" || command?.[1] === "help")
      return notifyHere(HELP);
    if (command?.[1] === "copy")
      return notifyHere(
        "File approvals (/copy) are not supported in Telegram. Use the web workspace.",
      );
    const prompt = command?.[1] === "ask" ? command[3]?.trim() : text;
    if (!prompt)
      return notifyHere(
        "I can only read text in Telegram. Use /ask@BotName followed by your question. Photos, files, voice and other attachments are not supported.",
      );
    try {
      await app.sessions.submit(
        app.actors.establish(
          "telegram",
          `telegram:${chatId}`,
          connectionId,
          String(from.id),
          {
            messageId: String(message.message_id),
            updateId,
            chatType: privateChat
              ? "private"
              : (message.chat.type as "group" | "supergroup"),
          },
        ),
        {
          eventId: `${config.botId}:${updateId}`,
          text: prompt,
        },
      );
    } catch (error) {
      await notifyHere(
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
      else if (update.edited_message)
        await handleMessage(update.update_id, update.edited_message, true);
      else if (update.my_chat_member) {
        const membership = update.my_chat_member;
        if (
          (membership.chat.type === "group" ||
            membership.chat.type === "supergroup") &&
          String(membership.new_chat_member.user.id) === config.botId &&
          ["left", "kicked"].includes(membership.new_chat_member.status)
        )
          config.groupRemoved(String(membership.chat.id));
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
    let commandsRegistered = false;
    while (!signal.aborted) {
      try {
        if (!commandsRegistered) {
          await api.setMyCommands(COMMANDS, signal);
          await api.setMyCommands(
            COMMANDS.filter((item) =>
              ["ask", "home", "help"].includes(item.command),
            ),
            signal,
            "all_group_chats",
          );
          commandsRegistered = true;
        }
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
