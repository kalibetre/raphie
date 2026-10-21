export type ReplyDestination = {
  provider: "discord";
  connectionId: string;
  owner: "owner";
  conversation: string;
};

export type ChannelBinding = ReplyDestination & { sessionId: string };

export function sameDestination(a: ReplyDestination, b: ReplyDestination) {
  return (
    a.provider === b.provider &&
    a.connectionId === b.connectionId &&
    a.owner === b.owner &&
    a.conversation === b.conversation
  );
}
