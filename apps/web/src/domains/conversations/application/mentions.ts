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
