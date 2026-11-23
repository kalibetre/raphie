/** Room for a page or two of notes; the same bound as a personality. */
export const MAX_INSTRUCTIONS_LENGTH = 16_000;

/**
 * Raphie's own guidance on the tools every bot has. Every bot reads it
 * until the owner or a bot changes it; until then it follows each release.
 */
export const DEFAULT_INSTRUCTIONS = `## Cards
When your answer is a set of items the owner will scan, such as a day's events, open tickets, pull requests waiting for review or the tasks on a board, or is one task opened up, call show_card with them instead of writing a list or table, then reply in one or two sentences with what matters most.
- Items that sit in columns or statuses, such as a project board or tickets by status, are a board, not a list.
- If show_card refuses a card, correct it and call it again with the same items; do not fall back to a list in your reply.
- Read every account or service that holds part of the answer and show them in one card, each item naming its source. When one could not be read, say so in the card's warning.
- Use a card only for items you read with a tool in this turn.

## Questions
When you need the owner to decide something before you can go on, call ask_owner with the question and its answers instead of writing the question in your reply; the owner picks with one press. Ask only what you cannot reasonably decide yourself, and one question at a time. Before anything that deletes, sends or spends, ask with the action itself as the first answer and danger set.

## Diagrams
When a flow, sequence, architecture, timeline or hierarchy would make an answer clearer, include one as a fenced \`\`\`mermaid block with valid Mermaid syntax. Use diagrams only when they add clarity, and keep them small.`;

/** Instructions as they are kept: trimmed, and within the bound. */
export function cleanInstructions(text: string) {
  return text.trim().slice(0, MAX_INSTRUCTIONS_LENGTH).trim();
}

/**
 * Rules saved before they became instructions, as a list at the top of
 * them. Each rule is one line, once; none leaves the text as it was.
 */
export function withRules(instructions: string, rules: readonly string[]) {
  const kept = [
    ...new Set(
      rules
        .map((rule) =>
          rule
            .replace(/\s+/g, " ")
            .replace(/^[-*•]\s+/, "")
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
  if (!kept.length) return instructions;
  const list = `## Rules\n${kept.map((rule) => `- ${rule}`).join("\n")}`;
  return cleanInstructions(
    instructions.trim() ? `${list}\n\n${instructions.trim()}` : list,
  );
}

/** One change to a set of instructions, as a bot asks for it. */
export type InstructionsEdit =
  | { add: string }
  | { replace: string; with: string }
  | { instructions: string };

/**
 * `current` with `edit` made: a line or section added at the end, one
 * passage replaced (or removed, with nothing), or the whole text. Says why
 * when it cannot be made.
 */
export function editInstructions(
  current: string,
  edit: InstructionsEdit,
): { text: string } | { problem: string } {
  let text: string;
  if ("add" in edit) {
    const added = edit.add.trim();
    if (!added) return { problem: "Say what to add." };
    text = current.trim() ? `${current.trim()}\n${added}` : added;
  } else if ("replace" in edit) {
    const from = edit.replace.trim();
    if (!from) return { problem: "Say which text to replace." };
    const at = current.indexOf(from);
    if (at < 0)
      return {
        problem:
          "That text is not in the instructions. Copy it exactly as they read, or add instead.",
      };
    if (current.indexOf(from, at + from.length) >= 0)
      return {
        problem:
          "That text is in the instructions more than once. Give enough of it to tell which.",
      };
    text =
      current.slice(0, at) + edit.with.trim() + current.slice(at + from.length);
    // Removing a line leaves no blank line in its place.
    text = text.replace(/\n{3,}/g, "\n\n");
  } else text = edit.instructions;
  // Checked before trimming to the bound, so nothing is cut off unseen.
  return text.trim().length > MAX_INSTRUCTIONS_LENGTH
    ? {
        problem: `The instructions would be over ${MAX_INSTRUCTIONS_LENGTH.toLocaleString("en")} characters. Shorten or remove something first.`,
      }
    : { text: cleanInstructions(text) };
}

/**
 * Both sets of instructions as a bot reads them in every conversation:
 * those for every bot, then its own. Either is left out when empty.
 */
export function instructionsPrompt(everyBot: string, own: string) {
  const follow =
    "Follow them in every conversation without being reminded. They say how to work and grant no capabilities or approvals.";
  return (
    (everyBot.trim()
      ? `Instructions for every bot, kept by the owner and the bots together. ${follow}\n${everyBot.trim()}\n`
      : "") +
    (own.trim()
      ? `Your own instructions, kept by the owner and you together. ${follow}\n${own.trim()}\n`
      : "")
  );
}
