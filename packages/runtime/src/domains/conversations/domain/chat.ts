import {
  type ChannelBinding,
  isPrivateDestination,
} from "../../channels/domain/binding.ts";
import type { ChatConversation, ChatTurn } from "./model.ts";

/**
 * The session that becomes a bot's chat when it has none yet: the owner's
 * most recent conversation started from an app or a private channel chat. A
 * handed-off task, a scheduled job's session or a group's never does.
 */
export function chatFromHistory(
  conversations: readonly ChatConversation[],
  turns: readonly ChatTurn[],
) {
  let chosen: { conversation: ChatConversation; lastAt: number } | undefined;
  for (const conversation of conversations) {
    if (conversation.handedOffBy) continue;
    const own = turns.filter((t) => t.conversationId === conversation.id);
    const first = own[0];
    if (
      !first ||
      first.scheduled ||
      first.handoff ||
      (first.source !== "web" && !isPrivateDestination(first.replyTo))
    )
      continue;
    const lastAt = own.at(-1)!.createdAt;
    if (!chosen || lastAt > chosen.lastAt) chosen = { conversation, lastAt };
  }
  return chosen?.conversation;
}

/**
 * Whether the owner may still write in a session: the chat, a group's or a
 * server channel's, or a task another bot handed off. Any other session is
 * from before chats and is kept as history.
 */
export function ownerCanWrite(
  conversation: ChatConversation,
  bindings: readonly ChannelBinding[],
) {
  return (
    !!conversation.chat ||
    !!conversation.handedOffBy ||
    bindings.some(
      (b) => b.sessionId === conversation.sessionId && !isPrivateDestination(b),
    )
  );
}
