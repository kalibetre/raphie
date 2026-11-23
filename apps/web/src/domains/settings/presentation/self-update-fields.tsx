import type { SelfUpdates } from "@raphie/contracts";

import { Switch } from "../../../shared/ui/switch";

/**
 * What the bot may change by itself: its personality, the owner's profile
 * and its skills.
 */
export function SelfUpdateFields({
  value,
  pending,
  onChange,
}: {
  value: SelfUpdates;
  pending: boolean;
  onChange: (value: SelfUpdates) => void;
}) {
  return (
    <section className="bot-editor-section" aria-label="Self-updates">
      <h2>Self-updates</h2>
      <p>
        Changes are saved right away and shown in the conversation, where you
        can undo them. Earlier ones are in revision history, the You page and
        Skills.
      </p>
      <div className="self-updates">
        <label className="self-update">
          <span>
            <strong>Update its personality</strong>
            <small>
              When you ask for a different manner, or it learns what works for
              you. It also adds to its instructions when you say “always” or ask
              it to note something.
            </small>
          </span>
          <Switch
            checked={value.personality}
            disabled={pending}
            onCheckedChange={(personality) =>
              onChange({ ...value, personality })
            }
          />
        </label>
        <label className="self-update">
          <span>
            <strong>Update “You”</strong>
            <small>
              Your name, time zone and a few lines about you. Every bot reads
              them.
            </small>
          </span>
          <Switch
            checked={value.owner}
            disabled={pending}
            onCheckedChange={(owner) => onChange({ ...value, owner })}
          />
        </label>
        <label className="self-update">
          <span>
            <strong>Write its own skills</strong>
            <small>
              When it notices a task you repeat, or works out how something of
              yours is done. It can improve your skills too.
            </small>
          </span>
          <Switch
            checked={value.skills}
            disabled={pending}
            onCheckedChange={(skills) => onChange({ ...value, skills })}
          />
        </label>
      </div>
    </section>
  );
}
