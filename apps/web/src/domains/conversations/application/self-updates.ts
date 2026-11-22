import type { BotProfile, OwnerProfile } from "@raphie/contracts";

import type { ToolStep } from "./run-projection";

/**
 * A change a bot made to itself or to the owner's profile in one reply,
 * found by its tool step; what changed is read from what was saved then.
 */
export type SelfUpdateNote = {
  kind: "personality" | "owner";
  id: string;
  startedAt: number;
  doneAt: number;
};

const TOOLS = {
  update_personality: "personality",
  update_owner_profile: "owner",
} as const;

/** Clock slack between a step's events and the save they bracket. */
const SLACK = 2000;

/** The finished self-updates among a reply's tool steps, in order. */
export function selfUpdateNotes(steps: ToolStep[]): SelfUpdateNote[] {
  return steps.flatMap((step) => {
    const kind = TOOLS[step.tool as keyof typeof TOOLS];
    return kind && step.doneAt && !step.server
      ? [{ kind, id: step.id, startedAt: step.startedAt, doneAt: step.doneAt }]
      : [];
  });
}

const during = (note: SelfUpdateNote, at: number | null) =>
  at !== null && at >= note.startedAt - SLACK && at <= note.doneAt + SLACK;

/**
 * The revision the bot saved during `note`, and the one before it to undo
 * to. Undefined when it saved none, as when it was not allowed.
 */
export function personalityEdit(history: BotProfile[], note: SelfUpdateNote) {
  // History is newest first.
  const index = history.findIndex(
    (revision) =>
      revision.changedBy === "bot" && during(note, revision.updatedAt),
  );
  if (index < 0) return undefined;
  return { edit: history[index]!, before: history[index + 1] };
}

/**
 * Whether the owner's profile is still as the bot saved it during `note`:
 * false when the save failed or the profile has changed since.
 */
export function ownerSaved(owner: OwnerProfile, note: SelfUpdateNote) {
  return during(note, owner.updatedAt);
}
