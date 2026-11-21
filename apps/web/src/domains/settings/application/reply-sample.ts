import type { ReplyStyle } from "@raphie/contracts";

/** A made-up reply, as a bot with `style` might write it. */
export type ReplySample = {
  lead: string;
  context: string | null;
  heading: string | null;
  /** A list, or one sentence when the style prefers prose. */
  details: string[] | string;
};

const NOTES = ["Bring last year's X-ray", "Parking is behind the building"];

/**
 * The sample reply the Replies settings show beside their sliders, so the
 * owner sees what each setting does before saving. The desktop app builds
 * the same one (`apps/desktop/app/src/view/settings/profile.rs`).
 */
export function replySample(style: ReplyStyle): ReplySample {
  const lead =
    style.warmth === "plain"
      ? "Wed 14:00, Bole clinic. It works."
      : style.warmth === "warm"
        ? "Good news: Wed 14:00 at Bole clinic works for Dr. Amare!"
        : "Wed 14:00 at Bole clinic works.";
  const context =
    style.length === "short"
      ? null
      : style.length === "balanced"
        ? "Dr. Amare has a 30-minute slot."
        : "Dr. Amare has a 30-minute slot. Tuesday was earlier but clashes with your 9:00 call, and he's away from Friday.";
  return {
    lead: style.emoji ? `${lead} 🦷` : lead,
    context,
    heading: style.formatting === "structured" ? "Before you go" : null,
    details:
      style.formatting === "prose"
        ? "Bring last year's X-ray; parking is behind the building."
        : NOTES,
  };
}
