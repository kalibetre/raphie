import type { TelegramMessage } from "./api.ts";

/** Telegram entities use UTF-16 offsets, matching JavaScript string indexes. */
export function groupMessageText(
  message: TelegramMessage,
  username: string,
): string | null {
  const text = message.text ?? message.caption;
  if (!username || !text) return null;
  const command = /^\/\w+@([A-Za-z0-9_]+)(?=\s|$)/.exec(text);
  if (command)
    return command[1]!.toLowerCase() === username.toLowerCase() ? text : null;
  const mentions = (
    (message.text !== undefined
      ? message.entities
      : message.caption_entities) ?? []
  ).filter(
    (entity) =>
      entity.type === "mention" &&
      Number.isInteger(entity.offset) &&
      Number.isInteger(entity.length) &&
      entity.offset >= 0 &&
      entity.length > 0 &&
      entity.offset + entity.length <= text.length &&
      text.slice(entity.offset, entity.offset + entity.length).toLowerCase() ===
        `@${username.toLowerCase()}`,
  );
  if (!mentions.length) return null;
  let result = text;
  for (const entity of mentions.sort((a, b) => b.offset - a.offset))
    result =
      result.slice(0, entity.offset) +
      result.slice(entity.offset + entity.length);
  return result.trim();
}
