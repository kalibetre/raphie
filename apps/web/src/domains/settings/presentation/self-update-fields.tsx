import type { SelfUpdates } from "@raphie/contracts";

import { Switch } from "../../../shared/ui/switch";

/** What the bot may change by itself: its personality and the owner's profile. */
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
        Changes are saved right away and shown in the conversation. Undo any of
        them from revision history or the You page.
      </p>
      <div className="self-updates">
        <label className="self-update">
          <span>
            <strong>Update its personality</strong>
            <small>
              When you ask for a different manner, or it learns what works for
              you.
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
      </div>
    </section>
  );
}
