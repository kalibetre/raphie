import type { ReplyStyle } from "@raphie/contracts";

import { Button } from "../../../shared/ui/button";

/** A new bot's replies: short and plain, as every bot's were before. */
export const defaultReplyStyle: ReplyStyle = {
  length: "short",
  warmth: "default",
  formatting: "default",
  emoji: false,
};

const dials = [
  {
    key: "length",
    label: "Length",
    choices: [
      ["short", "Short"],
      ["balanced", "Balanced"],
      ["detailed", "Detailed"],
    ],
  },
  {
    key: "warmth",
    label: "Warmth",
    choices: [
      ["plain", "Plain"],
      ["default", "Default"],
      ["warm", "Warm"],
    ],
  },
  {
    key: "formatting",
    label: "Formatting",
    choices: [
      ["prose", "Prose"],
      ["default", "Default"],
      ["structured", "Lists & tables"],
    ],
  },
  {
    key: "emoji",
    label: "Emoji",
    choices: [
      [false, "Off"],
      [true, "On"],
    ],
  },
] as const;

const lengthNote: Record<ReplyStyle["length"], string> = {
  short: "The answer first; most replies under 80 words.",
  balanced: "The answer first, with a line of context; most under 150 words.",
  detailed: "The answer first, then the reasoning and caveats you'd want.",
};

/** How a bot writes back: four small dials, saved with its profile. */
export function ReplyStyleFields({
  style,
  pending,
  onChange,
}: {
  style: ReplyStyle;
  pending: boolean;
  onChange: (style: ReplyStyle) => void;
}) {
  return (
    <section className="bot-editor-section" aria-label="Replies">
      <h2>Replies</h2>
      <p>How this bot writes back. Its personality can still ask for more.</p>
      <div className="reply-style">
        {dials.map((dial) => (
          <div key={dial.key} className="reply-style-row">
            <span className="reply-style-label" id={`reply-${dial.key}`}>
              {dial.label}
            </span>
            <div
              className="reply-style-choices"
              role="group"
              aria-labelledby={`reply-${dial.key}`}
            >
              {dial.choices.map(([value, label]) => (
                <Button
                  key={String(value)}
                  type="button"
                  size="sm"
                  variant={style[dial.key] === value ? "secondary" : "ghost"}
                  aria-pressed={style[dial.key] === value}
                  disabled={pending}
                  onClick={() => onChange({ ...style, [dial.key]: value })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ))}
        <p className="reply-style-note">{lengthNote[style.length]}</p>
      </div>
    </section>
  );
}
