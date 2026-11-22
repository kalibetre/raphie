import type { BotProfile } from "@raphie/contracts";
import { ArrowLeft, X } from "lucide-react";
import { useState } from "react";

import {
  botColors,
  botPalette,
} from "../../domains/settings/application/bot-tone";
import { runtimePlace } from "../../domains/settings/application/team-presence";
import {
  useBots,
  usePersonalityPresets,
} from "../../domains/settings/infrastructure/use-bots";
import { BotSetup } from "../../domains/settings/presentation/bot-setup";
import brandMark from "../../shared/favicon.svg?inline";
import { Button } from "../../shared/ui/button";
import {
  MeetStep,
  startingPersonality,
  type TeammateDraft,
  WorkStep,
} from "./teammate-steps";

type Step = "welcome" | "meet" | "work" | "provider";

/** Used when the runtime offers no built-in personalities. */
const starterPersonality =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

/**
 * How a teammate joins, the first one or any later one, through the same
 * steps: meet them (name, what they handle, colour), choose how they work,
 * then give them a way to think. A fresh install says hello first.
 *
 * - `first`: a fresh install's one bot, edited in place.
 * - `new`: a bot being added; finishing "how they work" creates it, and it
 *   then opens in `setup`.
 * - `setup`: a bot with no model and nothing said yet, on the last step.
 */
export type TeammateFlowMode =
  | { kind: "first"; bot: BotProfile }
  | { kind: "new" }
  | { kind: "setup"; bot: BotProfile };

export function TeammateFlow({
  mode,
  onProviders,
  onClose,
  onCreated,
}: {
  mode: TeammateFlowMode;
  /** Opens the bot's provider settings, for a connection that needs care. */
  onProviders: () => void;
  /** Leaves the flow: skips setting the bot up, or cancels adding one. */
  onClose: () => void;
  onCreated: (botId: string) => void;
}) {
  const bots = useBots();
  const presets = usePersonalityPresets().data?.items;
  const bot = mode.kind === "new" ? undefined : mode.bot;
  const botId = bot?.id ?? "new-bot";
  const steps: Step[] =
    mode.kind === "first"
      ? ["welcome", "meet", "work", "provider"]
      : ["meet", "work", "provider"];
  const [step, setStep] = useState<Step>(
    mode.kind === "first"
      ? "welcome"
      : mode.kind === "setup"
        ? "provider"
        : "meet",
  );
  const [draft, setDraft] = useState<TeammateDraft>(() =>
    bot
      ? {
          name: bot.name,
          description: bot.description,
          color: bot.color ?? botPalette[0].color,
          personality: bot.personality,
        }
      : {
          name: "",
          description: "",
          // A colour no teammate wears yet.
          color:
            botColors([...(bots.data?.items ?? []), { id: "new-bot" }]).get(
              "new-bot",
            ) ?? botPalette[1].color,
          personality: starterPersonality,
        },
  );
  const change = (next: Partial<TeammateDraft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const at = steps.indexOf(step);
  const pending = bots.save.isPending || bots.create.isPending;
  const error = (bots.save.error ?? bots.create.error)?.message;

  /** Leaving "how they work": creates the new bot, or saves what changed. */
  async function finishWork() {
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      personality: draft.personality.trim(),
      color: draft.color,
    };
    if (!bot) {
      const created = await bots.create.mutateAsync(input);
      onCreated(created.id);
      return;
    }
    const changed =
      input.name !== bot.name ||
      input.description !== bot.description ||
      input.color !== (bot.color ?? botPalette[0].color) ||
      input.personality !== bot.personality.trim();
    if (changed)
      await bots.save.mutateAsync({ ...input, revision: bot.revision });
    setStep("provider");
  }

  return (
    <main className="onboarding">
      <ol
        className="onboarding-progress"
        aria-label={`Step ${at + 1} of ${steps.length}`}
      >
        {steps.map((s, i) => (
          <li key={s} data-done={i <= at || undefined} />
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
        {step === "welcome" && <Welcome onNext={() => setStep("meet")} />}
        {step === "meet" && (
          <MeetStep
            botId={botId}
            draft={draft}
            heading="Meet your new teammate"
            lede="Give them a name, a colour and something to look after."
            onChange={change}
            onNext={() => {
              change({
                personality: startingPersonality(draft.personality, presets),
              });
              setStep("work");
            }}
            actions={
              <div className="onboarding-actions">
                {mode.kind === "first" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("welcome")}
                  >
                    <ArrowLeft />
                    Back
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" size="lg" disabled={!draft.name.trim()}>
                  Next
                </Button>
              </div>
            }
          />
        )}
        {step === "work" && (
          <WorkStep
            botId={botId}
            draft={draft}
            presets={presets}
            onChange={change}
            error={error}
            actions={
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
                  disabled={pending}
                  onClick={() => void finishWork()}
                >
                  {pending ? "Saving…" : "Next"}
                </Button>
              </div>
            }
          />
        )}
        {step === "provider" && bot && (
          <>
            <BotSetup
              botId={bot.id}
              name={bot.name}
              onProviders={onProviders}
            />
            <div className="onboarding-actions onboarding-actions-end">
              <Button variant="link" onClick={onClose}>
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
