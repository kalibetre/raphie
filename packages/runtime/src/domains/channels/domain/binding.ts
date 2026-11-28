import type { ChannelPlatform } from "@raphie/contracts";

export type ReplyDestination = {
  provider: ChannelPlatform;
  connectionId: string;
  owner: "owner";
  conversation: string;
};

const platforms: Record<
  ChannelPlatform,
  {
    /** User-facing names for refusal messages. */
    name: string;
    place: string;
    /** Splits a conversation ID into the platform's own identifiers. */
    parse(conversation: string): {
      channelId: string;
      guildId?: string;
      threadId?: string;
    };
    /** A conversation only the owner reads. */
    private(conversation: string): boolean;
  }
> = {
  // "discord:<guild or @me>:<channel>[:<thread>]"
  discord: {
    name: "Discord",
    place: "thread",
    parse(conversation) {
      const [, guildId, channelId, threadId] = conversation.split(":");
      return {
        channelId: channelId!,
        guildId,
        ...(threadId ? { threadId } : {}),
      };
    },
    private: (conversation) => conversation.startsWith("discord:@me:"),
  },
  // "telegram:<chat>"; private-user IDs are positive, groups negative.
  telegram: {
    name: "Telegram",
    place: "chat",
    parse: (conversation) => ({ channelId: conversation.split(":")[1]! }),
    private: (conversation) => /^telegram:[1-9]\d*$/.test(conversation),
  },
};

export function channelNames(provider: ChannelPlatform) {
  const { name, place } = platforms[provider];
  return { name, place };
}

export function parseConversation(
  provider: ChannelPlatform,
  conversation: string,
) {
  return platforms[provider].parse(conversation);
}

export type ChannelBinding = ReplyDestination & { sessionId: string };

export function sameDestination(a: ReplyDestination, b: ReplyDestination) {
  return (
    a.provider === b.provider &&
    a.connectionId === b.connectionId &&
    a.owner === b.owner &&
    a.conversation === b.conversation
  );
}

/**
 * A chat only the owner reads, such as a private Telegram chat or a Discord
 * direct message. It joins the owner's one chat with the bot; a group or a server
 * channel, which others read, keeps its own.
 */
export function isPrivateDestination(
  destination:
    Pick<ReplyDestination, "provider" | "conversation"> | null | undefined,
) {
  return (
    !!destination &&
    platforms[destination.provider].private(destination.conversation)
  );
}

/** Telegram group/supergroup IDs are negative; private-user IDs are positive. */
export function isSharedTelegramDestination(
  destination:
    Pick<ReplyDestination, "provider" | "conversation"> | null | undefined,
) {
  return (
    destination?.provider === "telegram" &&
    /^telegram:-[1-9]\d*$/.test(destination.conversation)
  );
}
