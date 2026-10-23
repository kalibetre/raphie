import { setTimeout as delay } from "node:timers/promises";

import type { DiscordAdapterConfig } from "@chat-adapter/discord";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { Message, Thread } from "chat";
import { Chat, ConsoleLogger } from "chat";

import type { ChannelServices } from "../../application/channels/ports.ts";
import { InputError } from "../../domains/approvals/infrastructure/pi-file-approvals.ts";
import { MAX_FILE_BYTES } from "../../domains/attachments/infrastructure/local-attachment-store.ts";
import { createDeliveryWorker } from "../../domains/delivery/application/worker.ts";
import { decodeDiscordOperation, discordRenderer } from "./delivery.ts";

type FetchRequest = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

/** REST posting only needs a channel ID; incoming SDK routes also contain its guild. */
export async function resolveDiscordThread(
  config: {
    botToken: string;
    channelId: string;
    guildId?: string;
  },
  lookup: FetchRequest = fetch,
) {
  const response = await lookup(
    `https://discord.com/api/v10/channels/${encodeURIComponent(config.channelId)}`,
    {
      headers: { Authorization: `Bot ${config.botToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Discord channel lookup failed (${response.status}). Check the channel ID and bot permissions.`,
    );
  const channel = (await response.json()) as { id: string; guild_id?: string };
  if (channel.id !== config.channelId)
    throw new Error("Discord returned a different channel.");
  const guild = channel.guild_id || "@me";
  if (config.guildId && config.guildId !== guild)
    throw new Error("DISCORD_GUILD_ID does not match the configured channel.");
  return `discord:${guild}:${channel.id}`;
}

export function createDiscordBridge(
  app: ChannelServices,
  config: DiscordAdapterConfig & {
    applicationId: string;
    ownerId: string;
    threadId: string;
    attachmentFetch?: FetchRequest;
  },
) {
  // SDK info logs include message content; keep it out of service logs.
  const logger = new ConsoleLogger("silent");
  const adapter = createDiscordAdapter({ ...config, logger });
  const chat = new Chat({
    userName: "raphie",
    adapters: { discord: adapter },
    state: createMemoryState(),
    logger,
    concurrency: "concurrent",
  });
  const target = adapter.decodeThreadId(config.threadId);
  const authorized = (userId: string, threadId: string) => {
    if (userId !== config.ownerId) return false;
    const incoming = adapter.decodeThreadId(threadId);
    // Gateway mentions create child threads; their encoded route retains the
    // parent channel. Authorize that parent, never an arbitrary thread prefix.
    return (
      incoming.guildId === target.guildId &&
      incoming.channelId === target.channelId &&
      (!target.threadId || incoming.threadId === target.threadId)
    );
  };

  async function receive(thread: Thread, message: Message) {
    if (!authorized(message.author.userId, thread.id) || message.author.isBot)
      return;
    try {
      const text = message.text.replace(/^<@!?\d+>\s*/, "").trim();
      if (!/^\/copy(?:\s|$)/.test(text)) {
        if (message.attachments.length)
          throw new InputError(
            "Chat currently accepts text only. Use /copy with attachments to run the file approval experiment.",
          );
        await app.sessions.submit(
          app.actors.establish("discord", thread.id, config.applicationId),
          {
            eventId: message.id,
            text,
          },
        );
        return;
      }
      if (message.attachments.length > 4)
        throw new InputError("Attach at most four files.");
      const files = [];
      for (const attachment of message.attachments) {
        if ((attachment.size ?? 0) > MAX_FILE_BYTES)
          throw new InputError("Files must be 8 MiB or smaller.");
        const url = new URL(attachment.url ?? "");
        if (
          url.protocol !== "https:" ||
          !["cdn.discordapp.com", "media.discordapp.net"].includes(
            url.hostname,
          ) ||
          url.port ||
          url.username ||
          url.password
        ) {
          throw new InputError("Unsupported attachment URL.");
        }
        const response = await (config.attachmentFetch ?? fetch)(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok || !response.body)
          throw new InputError("Could not download the attachment.");
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > MAX_FILE_BYTES)
            throw new InputError("Files must be 8 MiB or smaller.");
          chunks.push(Buffer.from(chunk));
        }
        files.push(
          await app.files.put(
            attachment.name ?? "attachment",
            Buffer.concat(chunks),
          ),
        );
      }
      await app.sessions.copy(
        app.actors.establish("discord", thread.id, config.applicationId),
        {
          eventId: message.id,
          text: text.replace(/^\/copy\s*/, ""),
          files,
        },
      );
    } catch (error) {
      const text =
        error instanceof InputError
          ? error.message
          : "I could not accept that message. Please try again.";
      await adapter.postMessage(thread.id, { raw: text }).catch(() => {
        console.error("Discord message error notification failed.");
      });
    }
  }

  chat.onNewMessage(receive);
  chat.onNewMention(receive);
  chat.onDirectMessage(receive);
  chat.onSubscribedMessage(receive);
  chat.onAction(["raphie-approve", "raphie-reject"], async (event) => {
    if (!authorized(event.user.userId, event.threadId) || !event.value) return;
    await app.sessions.decideFile(
      app.actors.establish("discord", event.threadId, config.applicationId),
      event.value,
      event.actionId === "raphie-approve" ? "approved" : "rejected",
    );
  });
  chat.onAction(
    ["raphie-tool-approve", "raphie-tool-reject"],
    async (event) => {
      if (!authorized(event.user.userId, event.threadId) || !event.value)
        return;
      await app.sessions.decide(
        app.actors.establish("discord", event.threadId, config.applicationId),
        event.value,
        event.actionId === "raphie-tool-approve" ? "approved" : "rejected",
      );
    },
  );

  const flush = createDeliveryWorker(
    app.deliveries.forConnection(config.applicationId),
    discordRenderer(app.files),
    async (payload) => {
      const operation = decodeDiscordOperation(payload);
      const message = operation.messageId
        ? await adapter.editMessage(
            operation.threadId,
            operation.messageId,
            operation.message,
          )
        : await adapter.postMessage(operation.threadId, operation.message);
      return message.id;
    },
    app.telemetry,
  );

  async function listen(signal: AbortSignal) {
    while (!signal.aborted) {
      let listener: Promise<unknown> = Promise.resolve();
      await adapter.startGatewayListener(
        {
          waitUntil: (task) => {
            listener = task;
          },
        },
        60 * 60 * 1000,
        signal,
      );
      await listener;
      if (!signal.aborted)
        await delay(5000, undefined, { signal }).catch(() => {});
    }
  }

  return { adapter, chat, flush, listen };
}
