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
