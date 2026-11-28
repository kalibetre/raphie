import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import {
  chatSdkRenderer,
  decodeChatSdkOperation,
} from "../chat-sdk/delivery.ts";

/** Discord renders Markdown itself and caps a message at 2,000 characters. */
export function discordRenderer(files: AttachmentStore) {
  return chatSdkRenderer(files, { chunk: 1900, format: "raw" });
}

export const decodeDiscordOperation = decodeChatSdkOperation;
