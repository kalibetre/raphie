import type { BotProfile } from "@raphie/contracts";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { botPalette } from "../../domains/settings/application/bot-tone";
import { runtimePlace } from "../../domains/settings/application/team-presence";
import { useBots } from "../../domains/settings/infrastructure/use-bots";
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { BotSetup } from "../../domains/settings/presentation/bot-setup";
import brandMark from "../../shared/favicon.svg?inline";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";

type Step = "welcome" | "teammate" | "provider";

const steps: { id: Step; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "teammate", label: "Your first teammate" },
  { id: "provider", label: "A way to think" },
];

/**
 * A fresh install's first steps: the app says hello, the owner meets and
 * names the first bot, and the bot asks for a model. Connecting one ends it
 * on the bot's empty desk.
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
  const [step, setStep] = useState<Step>("welcome");
  // The colour being chosen is kept here, so Back and Next keep it.
  const [color, setColor] = useState<string>(bot.color ?? botPalette[0].color);
  const at = steps.findIndex((s) => s.id === step);
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
          <Teammate
            bot={bot}
            color={color}
            onColor={setColor}
            onBack={() => setStep("welcome")}
            onNext={() => setStep("provider")}
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
              <Button variant="ghost" onClick={() => setStep("teammate")}>
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

/** The first bot, named and coloured by the owner. */
function Teammate({
  bot,
  color,
  onColor,
  onBack,
  onNext,
}: {
  bot: BotProfile;
  color: string;
  onColor: (color: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const bots = useBots();
  const [name, setName] = useState(bot.name);
  const trimmed = name.trim();
  const changed =
    trimmed !== bot.name || color !== (bot.color ?? botPalette[0].color);

  async function next() {
    if (changed)
      await bots.save.mutateAsync({
        name: trimmed,
        description: bot.description,
        personality: bot.personality,
        color,
        revision: bot.revision,
      });
    onNext();
  }

  return (
    <form
      className="onboarding-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) void next();
      }}
    >
      <div className="onboarding-avatar">
        <BotAvatar id={bot.id} color={color} />
      </div>
      <h1>Meet your first teammate</h1>
      <p>They’ll handle your day-to-day. Give them any name you like.</p>
      <label className="onboarding-field">
        <span>Name</span>
        <Input
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="onboarding-colors" role="radiogroup" aria-label="Color">
        {botPalette.map((tone) => (
          <button
            key={tone.color}
            type="button"
            role="radio"
            aria-checked={color === tone.color}
            aria-label={tone.name}
            title={tone.name}
            style={{ background: tone.color }}
            onClick={() => onColor(tone.color)}
          />
        ))}
      </div>
      {bots.save.error && (
        <p className="onboarding-error" role="alert">
          {bots.save.error.message}
        </p>
      )}
      <div className="onboarding-actions">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <Button
          type="submit"
          size="lg"
          disabled={!trimmed || bots.save.isPending}
        >
          {bots.save.isPending ? "Saving…" : "Next"}
        </Button>
      </div>
    </form>
  );
}
