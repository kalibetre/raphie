import type { PersonalityPreset } from "@raphie/contracts";
import type { ReactNode } from "react";

import { botPalette } from "../../domains/settings/application/bot-tone";
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { Input } from "../../shared/ui/input";

/** A teammate as the owner shapes it, first or new. */
export type TeammateDraft = {
  name: string;
  description: string;
  color: string;
  personality: string;
};

/**
 * Meeting a teammate: a name, what it will handle and a colour. Onboarding
 * and "Add a teammate" ask the same, so they share this step.
 */
export function MeetStep({
  botId,
  draft,
  heading,
  lede,
  onChange,
  onNext,
  actions,
}: {
  botId: string;
  draft: TeammateDraft;
  heading: string;
  lede: string;
  onChange: (change: Partial<TeammateDraft>) => void;
  onNext: () => void;
  /** Back or Cancel, and Next. */
  actions: ReactNode;
}) {
  return (
    <form
      className="onboarding-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim()) onNext();
      }}
    >
      <div className="onboarding-avatar">
        <BotAvatar id={botId} color={draft.color} />
      </div>
      <h1>{heading}</h1>
      <p>{lede}</p>
      <label className="onboarding-field">
        <span>Name</span>
        <Input
          value={draft.name}
          maxLength={60}
          placeholder="Researcher"
          autoFocus
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label className="onboarding-field">
        <span>What will they handle?</span>
        <Input
          value={draft.description}
          maxLength={200}
          placeholder="Reads up on things and writes them down"
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <small>
          Your other teammates read this to know when to hand work over.
        </small>
      </label>
      <div className="onboarding-colors" role="radiogroup" aria-label="Colour">
        {botPalette.map((tone) => (
          <button
            key={tone.color}
            type="button"
            role="radio"
            aria-checked={draft.color === tone.color}
            aria-label={tone.name}
            title={tone.name}
            style={{ background: tone.color }}
            onClick={() => onChange({ color: tone.color })}
          />
        ))}
      </div>
      {actions}
    </form>
  );
}

/** How a teammate works: a built-in personality to start from. */
export function WorkStep({
  botId,
  draft,
  presets,
  onChange,
  error,
  actions,
}: {
  botId: string;
  draft: TeammateDraft;
  presets: readonly PersonalityPreset[] | undefined;
  onChange: (change: Partial<TeammateDraft>) => void;
  error?: string;
  /** Back, and the step that finishes. */
  actions: ReactNode;
}) {
  return (
    <div className="onboarding-card">
      <div className="onboarding-avatar">
        <BotAvatar id={botId} color={draft.color} />
      </div>
      <h1>How should {draft.name.trim()} work?</h1>
      <p>
        Pick a starting personality. You can put it in your own words later in
        Settings.
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
              aria-checked={preset.personality === draft.personality.trim()}
              onClick={() => onChange({ personality: preset.personality })}
            >
              <strong>{preset.name}</strong>
              <span>{preset.summary}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}
      {actions}
    </div>
  );
}

/**
 * The personality to start from: the draft's own when it is a built-in
 * one, else the first built-in, else the draft unchanged.
 */
export function startingPersonality(
  personality: string,
  presets: readonly PersonalityPreset[] | undefined,
) {
  const current = personality.trim();
  if (!presets?.length || presets.some((p) => p.personality === current))
    return personality;
  return presets[0].personality;
}
