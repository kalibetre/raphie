type Bot = { id: string; name: string };

/** The "@name" being typed before the caret: where it starts and what follows the @. */
export type MentionQuery = { start: number; query: string };

/**
 * An @ starts a mention only at the start of the draft or after whitespace,
 * so an email address never opens the menu. Names may have spaces, so the
 * query runs to the caret, up to a line break.
 */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1]!)) return null;
  const query = before.slice(start + 1);
  if (query.includes("\n") || query.length > 40) return null;
  return { start, query };
}

/** Bots whose name starts with what was typed, case aside. */
export function mentionMatches(bots: readonly Bot[], query: string) {
  const typed = query.toLowerCase();
  return bots.filter((bot) => bot.name.toLowerCase().startsWith(typed));
}

/** Replaces the typed "@que" with "@Name", then one space, and puts the caret after it. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
) {
  const rest = text.slice(caret);
  const tag = `@${name}${/^\s/.test(rest) ? "" : " "}`;
  return {
    text: text.slice(0, mention.start) + tag + rest,
    caret: mention.start + `@${name}`.length + 1,
  };
}

export type MentionPart = string | { bot: Bot; text: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits text around "@Name" for known bots, so a message can show each as
 * the bot it names. Longer names win ("@Chief of staff" over "@Chief"), and
 * an @ inside a word, like an email address, is left alone.
 */
export function splitMentions(text: string, bots: readonly Bot[]) {
  if (!bots.length || !text.includes("@")) return [text];
  const names = [...bots]
    .sort((a, b) => b.name.length - a.name.length)
    .map((bot) => escape(bot.name));
  const pattern = new RegExp(
    `(^|[\\s(])@(${names.join("|")})(?=$|[\\s.,!?;:)'"])`,
    "gi",
  );
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index + match[1]!.length;
    const bot = bots.find(
      (item) => item.name.toLowerCase() === match[2]!.toLowerCase(),
    )!;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ bot, text: `@${match[2]}` });
    last = at + 1 + match[2]!.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}
