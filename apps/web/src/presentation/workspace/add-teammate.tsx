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
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";

type Step = "meet" | "work";

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
  const [step, setStep] = useState<Step>("meet");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // A colour no teammate wears yet, as Settings would pick.
  const [color, setColor] = useState<string>(
    () =>
      botColors([...(bots.data?.items ?? []), { id: "new-bot" }]).get(
        "new-bot",
      ) ?? botPalette[1].color,
  );
  const [personality, setPersonality] = useState<string>();
  const chosen = personality ?? presets?.[0]?.personality ?? starterPersonality;
  const trimmed = name.trim();
  const at = step === "meet" ? 0 : 1;

  async function create() {
    const created = await bots.create.mutateAsync({
      name: trimmed,
      description: description.trim(),
      personality: chosen,
      color,
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
        {step === "meet" ? (
          <form
            className="onboarding-card"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed) setStep("work");
            }}
          >
            <div className="onboarding-avatar">
              <BotAvatar id="new-bot" color={color} />
            </div>
            <h1>Meet your new teammate</h1>
            <p>Give them a name, a colour and something to look after.</p>
            <label className="onboarding-field">
              <span>Name</span>
              <Input
                value={name}
                maxLength={60}
                placeholder="Researcher"
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="onboarding-field">
              <span>What will they handle?</span>
              <Input
                value={description}
                maxLength={200}
                placeholder="Reads up on things and writes them down"
                onChange={(event) => setDescription(event.target.value)}
              />
              <small>
                Your other teammates read this to know when to hand work over.
              </small>
            </label>
            <div
              className="onboarding-colors"
              role="radiogroup"
              aria-label="Colour"
            >
              {botPalette.map((tone) => (
                <button
                  key={tone.color}
                  type="button"
                  role="radio"
                  aria-checked={color === tone.color}
                  aria-label={tone.name}
                  title={tone.name}
                  style={{ background: tone.color }}
                  onClick={() => setColor(tone.color)}
                />
              ))}
            </div>
            <div className="onboarding-actions">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={!trimmed}>
                Next
              </Button>
            </div>
          </form>
        ) : (
          <div className="onboarding-card">
            <div className="onboarding-avatar">
              <BotAvatar id="new-bot" color={color} />
            </div>
            <h1>How should {trimmed} work?</h1>
            <p>
              Pick a starting personality. You can put it in your own words
              later in Settings.
            </p>
            {presets?.length ? (
              <div
                className="onboarding-presets"
                role="radiogroup"
                aria-label="Personality"
              >
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    className="onboarding-preset"
                    aria-checked={preset.personality === chosen}
                    onClick={() => setPersonality(preset.personality)}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.summary}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {bots.create.error && (
              <p className="onboarding-error" role="alert">
                {bots.create.error.message}
              </p>
            )}
            <div className="onboarding-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("meet")}
              >
                <ArrowLeft />
                Back
              </Button>
              <Button
                size="lg"
                disabled={bots.create.isPending}
                onClick={() => void create()}
              >
                {bots.create.isPending ? "Adding…" : `Add ${trimmed}`}
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
