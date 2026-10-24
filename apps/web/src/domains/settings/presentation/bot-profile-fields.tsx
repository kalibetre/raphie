import type { BotProfile } from "@raphie/contracts";

import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";

export function BotProfileFields({
  mode,
  name,
  description,
  soul,
  saved,
  pending,
  onName,
  onDescription,
  onSoul,
}: {
  mode: "profile" | "personality" | "create";
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
    <div className="bot-form settings-form">
      {mode !== "personality" && (
        <>
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
        </>
      )}
      {mode !== "profile" && (
        <>
          <label htmlFor="bot-soul">Personality</label>
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
        </>
      )}
    </div>
  );
}
