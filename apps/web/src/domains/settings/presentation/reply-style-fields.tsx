import type { ReplyStyle } from "@raphie/contracts";

import { Slider } from "../../../shared/ui/slider";
import { Switch } from "../../../shared/ui/switch";
import { replySample } from "../application/reply-sample";

/** A new bot's replies: short and plain, as every bot's were before. */
export const defaultReplyStyle: ReplyStyle = {
  length: "short",
  warmth: "default",
  formatting: "default",
  emoji: false,
};

/** Each slider's three stops, from its left end to its right. */
const sliders = [
  {
    key: "length",
    label: "Length",
    stops: [
      ["short", "Short"],
      ["balanced", "Balanced"],
      ["detailed", "Detailed"],
    ],
  },
  {
    key: "warmth",
    label: "Warmth",
    stops: [
      ["plain", "Plain"],
      ["default", "Default"],
      ["warm", "Warm"],
    ],
  },
  {
    key: "formatting",
    label: "Formatting",
    stops: [
      ["prose", "Prose"],
      ["default", "Default"],
      ["structured", "Lists & tables"],
    ],
  },
] as const;

/**
 * How a bot writes back: three sliders and an emoji switch, with a sample
 * reply that changes as they move. Saved with the bot's profile.
 */
export function ReplyStyleFields({
  style,
  pending,
  onChange,
}: {
  style: ReplyStyle;
  pending: boolean;
  onChange: (style: ReplyStyle) => void;
}) {
  const sample = replySample(style);
  return (
    <section className="bot-editor-section" aria-label="Replies">
      <h2>Replies</h2>
      <p>How this bot writes back. Its personality can still ask for more.</p>
      <div className="reply-style">
        <div className="reply-style-controls">
          {sliders.map((slider) => {
            const index = slider.stops.findIndex(
              ([value]) => value === style[slider.key],
            );
            const stop = slider.stops[index]!;
            return (
              <div key={slider.key} className="reply-style-slider">
                <div className="reply-style-top">
                  <span>{slider.label}</span>
                  <span className="reply-style-value">{stop[1]}</span>
                </div>
                <Slider
                  thumbLabel={slider.label}
                  min={0}
                  max={2}
                  step={1}
                  value={index}
                  disabled={pending}
                  valueText={stop[1]}
                  onValueChange={(value) =>
                    onChange({
                      ...style,
                      [slider.key]: slider.stops[value]![0],
                    })
                  }
                />
                <div className="reply-style-ends" aria-hidden="true">
                  <span>{slider.stops[0][1]}</span>
                  <span>{slider.stops[2][1]}</span>
                </div>
              </div>
            );
          })}
          <label className="reply-style-emoji">
            <span>Emoji</span>
            <Switch
              checked={style.emoji}
              disabled={pending}
              onCheckedChange={(emoji) => onChange({ ...style, emoji })}
            />
          </label>
        </div>
        <figure className="reply-sample" aria-label="Sample reply">
          <figcaption>Sample reply</figcaption>
          <p className="reply-sample-lead">{sample.lead}</p>
          {sample.context && <p>{sample.context}</p>}
          {sample.heading && (
            <p className="reply-sample-heading">{sample.heading}</p>
          )}
          {typeof sample.details === "string" ? (
            <p>{sample.details}</p>
          ) : (
            <ul>
              {sample.details.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </figure>
      </div>
    </section>
  );
}
