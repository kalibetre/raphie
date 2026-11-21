import {
  CornerUpRight,
  type LucideIcon,
  Sparkles,
  Square,
  SquarePen,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useId, useState } from "react";

import {
  insertSkill,
  type SlashItem,
  slashMatches,
  slashQuery,
} from "../application/slash";

/** Each command's glyph, as the buttons that do the same show it. */
const commandIcons: Record<string, LucideIcon> = {
  new: SquarePen,
  model: Sparkles,
  stop: Square,
  handoff: CornerUpRight,
};

/** A command the composer can run, with what it does. */
export type SlashCommand = SlashItem & { kind: "command"; run: () => void };

/**
 * Typing / at the start of the composer offers commands, which act at
 * once, and this bot's skills, which are written into the draft as
 * "/name " so the message invokes that skill.
 */
export function useSlashMenu({
  draft,
  commands,
  skills,
  input,
  update,
  onManageSkills,
}: {
  draft: string;
  commands: readonly SlashCommand[];
  skills: readonly SlashItem[];
  input: RefObject<HTMLTextAreaElement | null>;
  update: (text: string) => void;
  /** Opens this bot's Skills settings from the menu's footer. */
  onManageSkills?: () => void;
}) {
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the menu for what was typed then; typing more reopens it.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const query = slashQuery(draft, caret);
  const matches =
    query === null ? [] : slashMatches([...commands, ...skills], query);
  const open = query !== null && matches.length > 0 && dismissed !== query;
  const index = Math.min(active, Math.max(0, matches.length - 1));

  function track() {
    setCaret(input.current?.selectionStart ?? 0);
  }

  function choose(item: SlashItem) {
    setActive(0);
    if (item.kind === "command") {
      update("");
      setCaret(0);
      (item as SlashCommand).run();
      return;
    }
    const next = insertSkill(draft, item.name);
    update(next.text);
    setCaret(next.caret);
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
      setDismissed(query);
      return true;
    }
    return false;
  }

  const option = (item: SlashItem, i: number) => {
    const Glyph = item.kind === "command" ? commandIcons[item.name] : undefined;
    return (
      <div
        key={`${item.kind}-${item.name}`}
        id={`${id}-${item.kind}-${item.name}`}
        role="option"
        aria-selected={i === index}
        className="mention-option slash-option"
        // Keep the caret in the draft while choosing.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(item)}
      >
        {item.kind === "command" ? (
          <span className="slash-icon" aria-hidden="true">
            {Glyph && <Glyph />}
          </span>
        ) : (
          <span className="slash-tag">skill</span>
        )}
        <span className="slash-name">{item.name}</span>
        <span className="slash-description">{item.description}</span>
        {/* What Enter does: a command runs now, a skill waits for words. */}
        <kbd className="slash-enter">
          ↵ {item.kind === "command" ? "run" : "use"}
        </kbd>
      </div>
    );
  };
  const menu = open ? (
    <div
      className="mention-menu slash-menu"
      role="listbox"
      id={id}
      aria-label="Commands and skills"
    >
      {matches.map((item, i) => option(item, i))}
      <div className="slash-foot">
        <span>↑↓ choose · esc close</span>
        {onManageSkills && (
          <button
            type="button"
            className="slash-manage"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onManageSkills}
          >
            Manage skills →
          </button>
        )}
      </div>
    </div>
  ) : null;

  const current = matches[index];
  return {
    menu,
    open,
    track,
    onKeyDown,
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? id : undefined,
      "aria-activedescendant":
        open && current ? `${id}-${current.kind}-${current.name}` : undefined,
    },
  };
}
