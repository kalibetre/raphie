import type { Quote } from "@raphie/contracts";
import { Reply, X } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import { sessionPreview } from "../application/session-summaries";

/** Where an earlier message is drawn, so a quote can bring it into view. */
export const messageId = (turnId: string, author: Quote["author"]) =>
  `message-${turnId}-${author}`;

/**
 * Scrolls to a message and marks it briefly. Returns whether it was shown:
 * nothing happens for a message that is not loaded.
 */
export function showMessage(turnId: string, author: Quote["author"]) {
  const target = document.getElementById(messageId(turnId, author));
  if (!target) return false;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.dataset.quoted = "true";
  window.setTimeout(() => delete target.dataset.quoted, 1600);
  return true;
}

/**
 * The message a message quotes, inside it: who wrote it and how it starts,
 * with a coloured edge for the bot's words. Choosing it shows the original.
 */
export function QuoteBar({
  quote,
  botName,
}: {
  quote: Quote;
  botName: string;
}) {
  const who = quote.author === "bot" ? botName : "You";
  return (
    <button
      type="button"
      className="message-quote"
      data-author={quote.author}
      title={quote.excerpt}
      aria-label={`Quoting ${who}: ${quote.excerpt}. Show the message`}
      onClick={() => showMessage(quote.turnId, quote.author)}
    >
      <strong className="message-quote-author">{who}</strong>
      <span className="message-quote-excerpt">
        {sessionPreview(quote.excerpt)}
      </span>
    </button>
  );
}

/** The action that quotes a message, shown when the message is pointed at. */
export function QuoteAction({ onQuote }: { onQuote: () => void }) {
  return (
    <div className="message-actions">
      <Button variant="ghost" size="xs" onClick={onQuote}>
        <Reply aria-hidden="true" />
        Quote
      </Button>
    </div>
  );
}

/** The message the draft will quote, above the composer, with a way to drop it. */
export function ComposerQuote({
  quote,
  botName,
  onClear,
}: {
  quote: Quote;
  botName: string;
  onClear: () => void;
}) {
  const who = quote.author === "bot" ? botName : "You";
  return (
    <div className="composer-quote" data-author={quote.author}>
      <Reply className="composer-quote-icon" size={14} aria-hidden="true" />
      <strong className="message-quote-author">{who}</strong>
      <span className="message-quote-excerpt">
        {sessionPreview(quote.excerpt)}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Don't quote this message"
        title="Don't quote"
        onClick={onClear}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
