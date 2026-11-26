import type { Handoff, HandoffOutcome } from "@raphie/contracts";

import { HANDOFF_RESULT_MAX_LENGTH } from "../../conversations/domain/admission.ts";

/** Open tasks one bot may have with each other bot at a time. */
export const MAX_OPEN_HANDOFFS_PER_BOT = 3;

/** Working while any request is unfinished, else how the latest ended. */
export function handoffStatus(handoff: Pick<Handoff, "requests">) {
  if (handoff.requests.some((request) => request.outcome === null))
    return "working" as const;
  return handoff.requests.at(-1)?.outcome ?? ("working" as const);
}

export function openHandoffs(items: readonly Handoff[], botId: string) {
  return items.filter(
    (item) => item.to.id === botId && handoffStatus(item) === "working",
  ).length;
}

/** What the sending bot is told came back, within what a result may hold. */
export function resultText(
  bot: string,
  outcome: HandoffOutcome,
  answer: string | null,
  failure?: string,
) {
  const text =
    answer ??
    (outcome === "cancelled"
      ? `The owner cancelled the task before ${bot} finished.`
      : `${bot} could not finish the task. ${failure ?? "It gave no reply."}`);
  if (text.length <= HANDOFF_RESULT_MAX_LENGTH) return text;
  const note = `\n\n[${bot}'s reply was cut here: it was longer than a result can hold. The full reply is in ${bot}'s session.]`;
  return text.slice(0, HANDOFF_RESULT_MAX_LENGTH - note.length) + note;
}
