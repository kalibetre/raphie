import type { BotProfile } from "@raphie/contracts";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { botPalette } from "../../domains/settings/application/bot-tone";
import { runtimePlace } from "../../domains/settings/application/team-presence";
import {
  useBots,
  usePersonalityPresets,
} from "../../domains/settings/infrastructure/use-bots";
import { BotSetup } from "../../domains/settings/presentation/bot-setup";
import brandMark from "../../shared/favicon.svg?inline";
import { Button } from "../../shared/ui/button";
import { MeetStep, type TeammateDraft, WorkStep } from "./teammate-steps";

type Step = "welcome" | "teammate" | "work" | "provider";

const steps: { id: Step; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "teammate", label: "Your first teammate" },
  { id: "work", label: "How they work" },
  { id: "provider", label: "A way to think" },
];

/**
 * A fresh install's first steps: the app says hello, the owner meets the
 * first bot (its name, what it handles, its colour, how it works), and the
 * bot asks for a model. Connecting one ends it on the bot's empty desk.
 * "Add a teammate" asks the same of a new bot, through the same steps.
 */
export function Onboarding({
  bot,
  onProviders,
  onSkip,
}: {
  bot: BotProfile;
  /** Opens the bot's provider settings, for a connection that needs care. */
  onProviders: () => void;
  onSkip: () => void;
}) {
  const bots = useBots();
  const presets = usePersonalityPresets().data?.items;
  const [step, setStep] = useState<Step>("welcome");
  // The first bot as it is now: kept here so Back and Next keep the edits.
  const [draft, setDraft] = useState<TeammateDraft>(() => ({
    name: bot.name,
    description: bot.description,
    color: bot.color ?? botPalette[0].color,
    personality: bot.personality,
  }));
  const change = (next: Partial<TeammateDraft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const at = steps.findIndex((s) => s.id === step);

  /** Saves what changed about the first bot, then asks for a model. */
  async function save() {
    const changed =
      draft.name.trim() !== bot.name ||
      draft.description.trim() !== bot.description ||
      draft.color !== (bot.color ?? botPalette[0].color) ||
      draft.personality.trim() !== bot.personality.trim();
    if (changed)
      await bots.save.mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim(),
        personality: draft.personality.trim(),
        color: draft.color,
        revision: bot.revision,
      });
    setStep("provider");
  }

  return (
    <main className="onboarding">
      <ol
        className="onboarding-progress"
        aria-label={`Step ${at + 1} of ${steps.length}: ${steps[at].label}`}
      >
        {steps.map((s, i) => (
          <li key={s.id} data-done={i <= at || undefined} title={s.label} />
        ))}
      </ol>
      <section className="onboarding-step">
        {step === "welcome" && <Welcome onNext={() => setStep("teammate")} />}
        {step === "teammate" && (
          <MeetStep
            botId={bot.id}
            draft={draft}
            heading="Meet your first teammate"
            lede="They’ll handle your day-to-day. Give them any name you like."
            onChange={change}
            onNext={() => setStep("work")}
            actions={
              <div className="onboarding-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("welcome")}
                >
                  <ArrowLeft />
                  Back
                </Button>
                <Button type="submit" size="lg" disabled={!draft.name.trim()}>
                  Next
                </Button>
              </div>
            }
          />
        )}
        {step === "work" && (
          <WorkStep
            botId={bot.id}
            draft={draft}
            presets={presets}
            onChange={change}
            error={bots.save.error?.message}
            actions={
              <div className="onboarding-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("teammate")}
                >
                  <ArrowLeft />
                  Back
                </Button>
                <Button
                  size="lg"
                  disabled={bots.save.isPending}
                  onClick={() => void save()}
                >
                  {bots.save.isPending ? "Saving…" : "Next"}
                </Button>
              </div>
            }
          />
        )}
        {step === "provider" && (
          <>
            <BotSetup
              botId={bot.id}
              name={bot.name}
              onProviders={onProviders}
            />
            <div className="onboarding-actions">
              <Button variant="ghost" onClick={() => setStep("work")}>
                <ArrowLeft />
                Back
              </Button>
              <Button variant="link" onClick={onSkip}>
                Skip for now
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

/** The app greets the owner as raphie, before any bot appears. */
function Welcome({ onNext }: { onNext: () => void }) {
  const place = runtimePlace(location.href);
  return (
    <div className="onboarding-card">
      <img className="onboarding-mark" src={brandMark} alt="" />
      <h1>Welcome to raphie</h1>
      <p>A small team of assistants that work for you, on your own machine.</p>
      <p className="onboarding-place">
        <span className="status-dot" aria-hidden="true" />
        Running on {place === "This computer" ? "this computer" : place}
      </p>
      <Button size="lg" onClick={onNext} autoFocus>
        Continue
      </Button>
    </div>
  );
}
