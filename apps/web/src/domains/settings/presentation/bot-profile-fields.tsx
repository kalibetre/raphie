import type { BotProfile } from "@raphie/contracts";

import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { BotColorPicker } from "./bot-color-picker";

export function BotProfileFields({
  botId,
  color,
  automatic,
  onColor,
  name,
  description,
  soul,
  saved,
  pending,
  onName,
  onDescription,
  onSoul,
}: {
  botId: string;
  color: string | null;
  automatic: string;
  onColor: (color: string | null) => void;
  name: string;
  description: string;
  soul: string;
  saved?: BotProfile;
  pending: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onSoul: (value: string) => void;
}) {
  return (
    <>
      <section className="bot-editor-section" aria-label="Identity">
        <h2>Identity</h2>
        <p>How this bot appears in your sidebar and conversations.</p>
        <div className="bot-form settings-form">
          <label htmlFor="bot-name">Name</label>
          <Input
            id="bot-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => onName(e.target.value)}
            disabled={pending}
            placeholder="Research assistant"
          />
          <label htmlFor="bot-description">Description</label>
          <Input
            id="bot-description"
            maxLength={500}
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            disabled={pending}
            placeholder="What this bot helps you with"
          />
          <BotColorPicker
            botId={botId}
            color={color}
            automatic={automatic}
            pending={pending}
            onChange={onColor}
          />
        </div>
      </section>
      <section className="bot-editor-section" aria-label="Personality">
        <h2>Personality</h2>
        <p>
          Tone, values and working style, shared across this bot’s
          conversations.
        </p>
        <div className="bot-form settings-form">
          <label htmlFor="bot-soul" className="sr-only">
            Personality
          </label>
          <div className="soul-editor">
            <div className="soul-editor-heading">
              <strong>SOUL.md</strong>
              <span>
                {saved ? `Revision ${saved.revision}` : "Starting personality"}
              </span>
            </div>
            <Textarea
              id="bot-soul"
              className="bot-soul min-h-64 resize-y rounded-none border-0 p-4 font-mono text-xs leading-loose shadow-none md:min-h-72"
              required
              maxLength={16000}
              value={soul}
              onChange={(e) => onSoul(e.target.value)}
              disabled={pending}
              aria-describedby="bot-soul-note"
            />
          </div>
          <p id="bot-soul-note">
            Personality guides behavior. Models, connections and memory are
            configured separately.
          </p>
        </div>
      </section>
    </>
  );
}
