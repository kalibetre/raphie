import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import type { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";

/**
 * Leaves the bot with no chat, as a new bot has none, so the next message
 * from an app starts a session of its own. Its earlier chat stays, as a
 * session from before chats does.
 */
export async function withoutChat(app: Gateway) {
  await app.root.commit(async (tx) => {
    for (const item of (await tx.doc(Chats)).conversations)
      Reflect.deleteProperty(item, "chat");
  }, context);
}
