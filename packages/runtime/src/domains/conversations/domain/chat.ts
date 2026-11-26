import {
  type ChannelBinding,
  isPrivateDestination,
} from "../../channels/domain/binding.ts";
import type { ChatConversation, ChatTurn } from "./model.ts";

/**
 * The session that becomes a bot's chat when it has none yet: the owner's
 * most recent conversation started from an app or a private channel chat,
 * preferring one they had not archived. A handed-off task, a scheduled job's
 * session or a group's never does.
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
    const archived = !!conversation.archivedAt;
    if (
      !chosen ||
      (!archived && !!chosen.conversation.archivedAt) ||
      (archived === !!chosen.conversation.archivedAt && lastAt > chosen.lastAt)
    )
      chosen = { conversation, lastAt };
  }
  return chosen?.conversation;
}

/**
 * Whether a session belongs beside the bot's one chat: the chat itself, a
 * group's or a server channel's, or a task another bot handed off. Any other
 * is from before chats.
 */
export function isKept(
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

/**
 * The sessions to remove: every one from before chats, so only the chat,
 * groups', server channels' and handed-off sessions stay.
 * One with a turn still running, or named in `busy`, waits for a later
 * start.
 */
export function historyToRemove(
  conversations: readonly ChatConversation[],
  turns: readonly ChatTurn[],
  bindings: readonly ChannelBinding[],
  busy: ReadonlySet<string> = new Set(),
) {
  return conversations.filter(
    (conversation) =>
      !isKept(conversation, bindings) &&
      !busy.has(conversation.sessionId) &&
      !turns.some(
        (turn) =>
          turn.conversationId === conversation.id && turn.status === "pending",
      ),
  );
}
