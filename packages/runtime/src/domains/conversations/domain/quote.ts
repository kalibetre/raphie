import type { Quote } from "@raphie/contracts";

import type { ChatTurn } from "./model.ts";

/** How much of a quoted message is kept with the quote. */
export const QUOTE_EXCERPT_LENGTH = 280;

/**
 * The quote of an earlier message in a session: the owner's own words, or
 * the bot's in that turn. A scheduled job's prompt or another bot's brief is
 * not the owner's, and a message with no text yet cannot be quoted.
 */
export function quoteOf(
  turns: readonly ChatTurn[],
  conversationId: number,
  ref: Pick<Quote, "turnId" | "author">,
): Quote | undefined {
  const turn = turns.find(
    (t) => t.id === ref.turnId && t.conversationId === conversationId,
  );
  if (!turn) return undefined;
  const text =
    ref.author === "owner"
      ? turn.scheduled || turn.handoff
        ? undefined
        : turn.text
      : turn.answer;
  const excerpt = text?.trim().replace(/\s+/g, " ");
  if (!excerpt) return undefined;
  return {
    turnId: turn.id,
    author: ref.author,
    excerpt: excerpt.slice(0, QUOTE_EXCERPT_LENGTH),
  };
}

/** How the bot is told which earlier message the owner quotes. */
export function quoteInstruction(quote: Quote) {
  const whose = quote.author === "owner" ? "their own" : "your";
  const cut = quote.excerpt.length >= QUOTE_EXCERPT_LENGTH ? "…" : "";
  return `The owner quotes ${whose} earlier message: "${quote.excerpt}${cut}"\n\n`;
}
