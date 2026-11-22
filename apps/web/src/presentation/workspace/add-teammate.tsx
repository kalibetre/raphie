import { ArrowLeft, X } from "lucide-react";
import { useState } from "react";

import {
  botColors,
  botPalette,
} from "../../domains/settings/application/bot-tone";
import {
  useBots,
  usePersonalityPresets,
} from "../../domains/settings/infrastructure/use-bots";
import { Button } from "../../shared/ui/button";
import {
  MeetStep,
  startingPersonality,
  type TeammateDraft,
  WorkStep,
} from "./teammate-steps";

/** Used when the runtime offers no built-in personalities. */
const starterPersonality =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

/**
 * A new bot joins the team the way the first one did: the owner names it,
 * says what it will handle and picks its colour, then chooses how it works.
 * Once created it asks for a way to think on its own screen.
 */
export function AddTeammate({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (botId: string) => void;
}) {
  const bots = useBots();
  const presets = usePersonalityPresets().data?.items;
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState<TeammateDraft>(() => ({
    name: "",
    description: "",
    // A colour no teammate wears yet, as Settings would pick.
    color:
      botColors([...(bots.data?.items ?? []), { id: "new-bot" }]).get(
        "new-bot",
      ) ?? botPalette[1].color,
    personality: starterPersonality,
  }));
  const change = (next: Partial<TeammateDraft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const at = working ? 1 : 0;

  async function create() {
    const created = await bots.create.mutateAsync({
      name: draft.name.trim(),
      description: draft.description.trim(),
      personality: draft.personality.trim(),
      color: draft.color,
    });
    onCreated(created.id);
  }

  return (
    <main className="onboarding">
      <ol className="onboarding-progress" aria-label={`Step ${at + 1} of 3`}>
        {[0, 1, 2].map((i) => (
          <li key={i} data-done={i <= at || undefined} />
        ))}
      </ol>
      <Button
        variant="ghost"
        size="icon-sm"
        className="onboarding-close"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <X />
      </Button>
      <section className="onboarding-step">
        {working ? (
          <WorkStep
            botId="new-bot"
            draft={draft}
            presets={presets}
            onChange={change}
            error={bots.create.error?.message}
            actions={
              <div className="onboarding-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setWorking(false)}
                >
                  <ArrowLeft />
                  Back
                </Button>
                <Button
                  size="lg"
                  disabled={bots.create.isPending}
                  onClick={() => void create()}
                >
                  {bots.create.isPending
                    ? "Adding…"
                    : `Add ${draft.name.trim()}`}
                </Button>
              </div>
            }
          />
        ) : (
          <MeetStep
            botId="new-bot"
            draft={draft}
            heading="Meet your new teammate"
            lede="Give them a name, a colour and something to look after."
            onChange={change}
            onNext={() => {
              change({
                personality: startingPersonality(draft.personality, presets),
              });
              setWorking(true);
            }}
            actions={
              <div className="onboarding-actions">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" size="lg" disabled={!draft.name.trim()}>
                  Next
                </Button>
              </div>
            }
          />
        )}
      </section>
    </main>
  );
}
