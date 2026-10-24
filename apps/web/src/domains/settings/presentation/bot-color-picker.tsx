import { Check } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import { botPalette } from "../application/bot-tone";
import { BotAvatar } from "./bot-avatar";

export function BotColorPicker({
  botId,
  color,
  automatic,
  pending,
  onChange,
}: {
  botId: string;
  color: string | null;
  automatic: string;
  pending: boolean;
  onChange: (color: string | null) => void;
}) {
  return (
    <fieldset className="bot-color-picker" disabled={pending}>
      <legend>Bot color</legend>
      <div className="bot-color-preview">
        <BotAvatar id={botId} color={color ?? automatic} />
        <span>{color ? color.toUpperCase() : "Automatic color"}</span>
      </div>
      <div
        className="bot-color-options"
        role="group"
        aria-label="Bot color presets"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={color === null}
          onClick={() => onChange(null)}
        >
          Automatic
        </Button>
        {botPalette.map((entry) => (
          <button
            key={entry.color}
            type="button"
            className="bot-color-swatch"
            style={{ backgroundColor: entry.color }}
            aria-label={entry.name}
            aria-pressed={color === entry.color}
            title={entry.name}
            onClick={() => onChange(entry.color)}
          >
            {color === entry.color && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <label className="bot-color-custom" htmlFor="bot-custom-color">
        <input
          id="bot-custom-color"
          type="color"
          value={color ?? automatic}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        Custom color
      </label>
      <p>
        Used for this bot’s avatar and settings. Automatic avoids colors already
        in use.
      </p>
    </fieldset>
  );
}
