import { type KeyboardEvent, type RefObject, useId, useState } from "react";

import { BotAvatar } from "../../../settings/presentation/bot-avatar";
import {
  insertMention,
  mentionMatches,
  mentionQuery,
} from "../../application/mentions";

type Bot = { id: string; name: string };

/**
 * Typing @ in the composer offers the other bots. Choosing one writes
 * "@Name" into the draft, which tells this bot to hand the task to it.
 */
export function useMentions({
  draft,
  bots,
  input,
  update,
}: {
  draft: string;
  bots: readonly Bot[];
  input: RefObject<HTMLTextAreaElement | null>;
  update: (text: string) => void;
}) {
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the menu for this @ until another one is typed.
  const [dismissed, setDismissed] = useState<number>();
  const query = mentionQuery(draft, caret);
  const matches = query ? mentionMatches(bots, query.query) : [];
  const open = !!query && matches.length > 0 && dismissed !== query.start;
  const index = Math.min(active, Math.max(0, matches.length - 1));

  function track() {
    setCaret(input.current?.selectionStart ?? 0);
  }

  function choose(bot: Bot) {
    if (!query) return;
    const next = insertMention(draft, query, caret, bot.name);
    update(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  /** Handles the keys the open menu owns; returns whether it did. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index + step + matches.length) % matches.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(matches[index]!);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(query.start);
      return true;
    }
    return false;
  }

  const menu = open ? (
    <div
      className="mention-menu"
      role="listbox"
      id={id}
      aria-label="Hand this to another bot"
    >
      {matches.map((bot, i) => (
        <div
          key={bot.id}
          id={`${id}-${bot.id}`}
          role="option"
          aria-selected={i === index}
          className="mention-option"
          // Keep the caret in the draft while choosing.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(bot)}
        >
          <BotAvatar id={bot.id} />
          <span>{bot.name}</span>
        </div>
      ))}
      <p className="mention-hint">Hands the task to this bot</p>
    </div>
  ) : null;

  return {
    menu,
    track,
    onKeyDown,
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? id : undefined,
      "aria-activedescendant": open ? `${id}-${matches[index]!.id}` : undefined,
    },
  };
}
