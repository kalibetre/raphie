import type { CardTone } from "@raphie/contracts";

const DAY_MS = 86_400_000;

/** The calendar date of `at` on this device, as YYYY-MM-DD. */
export function localDate(at: number) {
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Whole days from `today` to `date`, both written YYYY-MM-DD. */
function daysUntil(date: string, today: string) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS,
  );
}

/**
 * How a due date reads on `today`: overdue in red, today and tomorrow in
 * amber, and later dates plainly. `soon` is false for the plain ones, which
 * need no badge.
 */
export function dueLabel(
  date: string,
  today: string,
): { label: string; tone: CardTone; soon: boolean } {
  const days = daysUntil(date, today);
  if (Number.isNaN(days)) return { label: date, tone: "neutral", soon: false };
  if (days < 0) return { label: `Overdue ${-days}d`, tone: "bad", soon: true };
  if (days === 0) return { label: "Due today", tone: "attention", soon: true };
  if (days === 1)
    return { label: "Due tomorrow", tone: "attention", soon: true };
  return {
    label: `Due ${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      // Another year is said, so next December is not mistaken for this one.
      ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    })}`,
    tone: "neutral",
    soon: false,
  };
}

/** Up to two letters for a person: "Kalkidan Betre" is "KB", "mara" is "M". */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // By character, not by code unit: a name may start with one that takes two.
  const letter = (word: string | undefined) => Array.from(word ?? "")[0] ?? "";
  const first = letter(words[0]);
  const last = words.length > 1 ? letter(words.at(-1)) : "";
  return (first + last).toUpperCase();
}
