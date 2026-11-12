export type ReplyDestination = {
  provider: "discord" | "telegram";
  connectionId: string;
  owner: "owner";
  conversation: string;
};

/** User-facing names for refusal messages; Discord's wording is unchanged. */
export function channelNames(provider: ReplyDestination["provider"]) {
  return provider === "telegram"
    ? { name: "Telegram", place: "chat" }
    : { name: "Discord", place: "thread" };
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
