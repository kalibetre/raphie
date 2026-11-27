import type { Tx } from "@earendil-works/pi-durable";

import { isPrivateDestination } from "../../channels/domain/binding.ts";
import { Chats } from "./pi-conversation-service.ts";

/**
 * Whether `conversationId` is the bot's chat with the owner, with every reply
 * it is working on staying private. Only there may a bot change what lasts:
 * its jobs, work items, instructions, personality and skills. A task from
 * another bot or a group never can, since what it saves would later run as
 * the owner's own, under the chat's permission mode. Fails closed: a tool
 * call can't tell which pending turn it serves, so one reply that may go
 * where others read it is enough to refuse.
 */
export async function inOwnersChat(tx: Tx, conversationId: number) {
  const chats = await tx.doc(Chats);
  const conversation = chats.conversations.find((c) => c.id === conversationId);
  if (!conversation?.chat || conversation.handedOffBy) return false;
  return chats.turns
    .filter(
      (t) => t.conversationId === conversation.id && t.status === "pending",
    )
    .every((t) => !t.replyTo || isPrivateDestination(t.replyTo));
}

/** What a bot hears when it tries that anywhere else. */
export const ONLY_IN_OWNERS_CHAT =
  "Only your private chat with the owner can change this. Ask the owner to do it there.";
