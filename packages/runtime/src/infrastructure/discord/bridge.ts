import { setTimeout as delay } from "node:timers/promises";

import type { DiscordAdapterConfig } from "@chat-adapter/discord";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { CardElement, Message, Thread } from "chat";
import { Chat, ConsoleLogger } from "chat";

import type { ChannelServices } from "../../application/channels/ports.ts";
import type { Approval } from "../../domains/approvals/infrastructure/pi-file-approvals.ts";
import { InputError } from "../../domains/approvals/infrastructure/pi-file-approvals.ts";
import type { ToolApproval } from "../../domains/approvals/infrastructure/pi-tool-approvals.ts";
import { MAX_FILE_BYTES } from "../../domains/attachments/infrastructure/local-attachment-store.ts";

type FetchRequest = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

export function toolApprovalCard(item: ToolApproval): CardElement {
  const pending = item.status === "pending" && Date.now() < item.expiresAt;
  return {
    type: "card",
    title: pending
      ? `Approve ${item.server}: ${item.tool}`
      : `Tool request ${item.status}`,
    children: [
      {
        type: "text",
        content: `Review the attached JSON for the exact arguments. Approval permits one call, which may change external data.\nExpires: ${new Date(item.expiresAt).toISOString()}\nRequest: ${item.id}`,
      },
      {
        type: "actions",
        children: [
          {
            type: "button",
            id: "raphie-tool-approve",
            value: item.id,
            label: "Approve once",
            style: "primary",
            disabled: !pending,
          },
          {
            type: "button",
            id: "raphie-tool-reject",
            value: item.id,
            label: "Decline",
            style: "danger",
            disabled: !pending,
          },
        ],
      },
    ],
  };
}

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

export function approvalCard(approval: Approval): CardElement {
  const pending =
    approval.status === "pending" && Date.now() < approval.expiresAt;
  return {
    type: "card",
    title: pending ? "Approve file copy" : `Request ${approval.status}`,
    children: [
      {
        type: "text",
        content: approval.text.slice(0, 1500) || "Attached files",
      },
      {
        type: "text",
        content: `${approval.files.length ? approval.files.map((f) => f.name).join(", ") : "Create approved-note.txt"}\nExpires: ${new Date(approval.expiresAt).toISOString()}\nRequest: ${approval.id}`,
      },
      {
        type: "actions",
        children: [
          {
            type: "button",
            id: "raphie-approve",
            value: approval.id,
            label: "Approve",
            style: "primary",
            disabled: !pending,
          },
          {
            type: "button",
            id: "raphie-reject",
            value: approval.id,
            label: "Decline",
            style: "danger",
            disabled: !pending,
          },
        ],
      },
    ],
  };
}

export function createDiscordBridge(
  app: ChannelServices,
  config: DiscordAdapterConfig & {
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
        await app.chats.send({
          source: "discord",
          eventId: message.id,
          actor: "owner",
          text,
          discordThreadId: thread.id,
        });
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
      await app.accept({
        source: "discord",
        eventId: message.id,
        actor: "owner",
        text: text.replace(/^\/copy\s*/, ""),
        files,
        discordThreadId: thread.id,
      });
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
    await app.decide(
      event.value,
      event.actionId === "raphie-approve" ? "approved" : "rejected",
      "owner",
      "discord",
    );
  });
  chat.onAction(
    ["raphie-tool-approve", "raphie-tool-reject"],
    async (event) => {
      if (!authorized(event.user.userId, event.threadId) || !event.value)
        return;
      await app.toolApprovals.decide(
        event.value,
        event.actionId === "raphie-tool-approve" ? "approved" : "rejected",
        "owner",
        "discord",
        event.threadId,
      );
    },
  );

  let pumping = false;

  async function flush() {
    if (pumping) return;
    pumping = true;
    try {
      for (
        let delivery;
        (delivery = await app.toolApprovals.claimDelivery());
      ) {
        try {
          const state = await app.toolApprovals.state();
          const item = state.approvals.find(
            (a) => a.id === delivery.approvalId,
          )!;
          const original = state.deliveries.find(
            (d) => d.approvalId === item.id && d.kind === "approval",
          );
          const card = toolApprovalCard(item);
          const message =
            delivery.kind === "resolved" && original?.messageId
              ? await adapter.editMessage(
                  delivery.threadId,
                  original.messageId,
                  card,
                )
              : await adapter.postMessage(delivery.threadId, {
                  card,
                  files: [
                    {
                      filename: `tool-request-${item.id}.json`,
                      data: Buffer.from(
                        JSON.stringify(
                          {
                            server: item.server,
                            tool: item.tool,
                            arguments: JSON.parse(item.argumentsJson),
                          },
                          null,
                          2,
                        ),
                      ),
                    },
                  ],
                });
          await app.toolApprovals.settleDelivery(delivery.id, message.id);
        } catch {
          await app.toolApprovals.settleDelivery(delivery.id, null);
        }
      }
      for (let delivery; (delivery = await app.claimDelivery());) {
        try {
          const state = await app.state();
          const approval = state.approvals.find(
            (a) => a.id === delivery.approvalId,
          )!;
          let message;
          if (delivery.kind === "result") {
            message = await adapter.postMessage(delivery.threadId, {
              raw: `Completed request ${approval.id}.`,
              files: await Promise.all(
                approval.results.map(async (f) => ({
                  filename: f.name,
                  data: Buffer.from(await app.files.read(f.id)),
                })),
              ),
            });
          } else if (delivery.kind === "resolved") {
            const original = state.deliveries.find(
              (d) => d.approvalId === approval.id && d.kind === "approval",
            );
            message = original?.messageId
              ? await adapter.editMessage(
                  delivery.threadId,
                  original.messageId,
                  approvalCard(approval),
                )
              : await adapter.postMessage(
                  delivery.threadId,
                  approvalCard(approval),
                );
          } else
            message = await adapter.postMessage(
              delivery.threadId,
              approvalCard(approval),
            );
          await app.settleDelivery(delivery.id, message.id);
        } catch {
          await app.settleDelivery(
            delivery.id,
            null,
            "Delivery failed or its outcome is unknown; inspect Discord before retrying.",
          );
        }
      }
      for (let delivery; (delivery = await app.chats.claimDelivery());) {
        try {
          await adapter.postMessage(delivery.threadId, { raw: delivery.text });
          await app.chats.settleDelivery(delivery.id, "sent");
        } catch {
          await app.chats.settleDelivery(delivery.id, "uncertain");
        }
      }
    } finally {
      pumping = false;
    }
  }

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
