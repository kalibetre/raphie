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
 * Both sets of instructions as a bot reads them in every conversation:
 * those for every bot, then its own. Either is left out when empty.
 */
export function instructionsPrompt(everyBot: string, own: string) {
  const grants =
    "They say how to work with your tools and grant no capabilities or approvals.";
  return (
    (everyBot.trim()
      ? `Instructions for every bot, kept by the owner and the bots together. ${grants}\n${everyBot.trim()}\n`
      : "") +
    (own.trim()
      ? `Your own instructions, kept by the owner and you together. ${grants}\n${own.trim()}\n`
      : "")
  );
}
