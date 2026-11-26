import type { ChatConversation, ChatTurn } from "./model.ts";

/**
 * The session that becomes a bot's chat when it has none yet: the owner's
 * most recent conversation started from an app. A handed-off task, a
 * scheduled job's session or one a channel started never becomes the chat.
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
    if (!first || first.source !== "web" || first.scheduled || first.handoff)
      continue;
    const lastAt = own.at(-1)!.createdAt;
    if (!chosen || lastAt > chosen.lastAt) chosen = { conversation, lastAt };
  }
  return chosen?.conversation;
}
