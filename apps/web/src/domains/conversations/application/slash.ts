/** What the `/` menu offers: an action the app runs, or a skill to invoke. */
export type SlashItem = {
  kind: "command" | "skill";
  name: string;
  description: string;
};

/**
 * The "/name" being typed: only at the very start of the draft, and only
 * until a space, so "/" later in a message (a path, a date) never opens
 * the menu.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith("/")) return null;
  const typed = text.slice(1, caret);
  if (caret < 1 || /\s/.test(typed) || /\s/.test(text.slice(0, caret)))
    return null;
  return typed.toLowerCase();
}

/** Items whose name starts with what was typed, commands first. */
export function slashMatches(items: readonly SlashItem[], query: string) {
  return items.filter((item) => item.name.startsWith(query));
}

/** The draft once a skill is chosen: "/name " and whatever followed. */
export function insertSkill(text: string, name: string) {
  const rest = text.replace(/^\/\S*\s?/, "");
  const next = `/${name} ${rest}`;
  return { text: next, caret: name.length + 2 };
}
