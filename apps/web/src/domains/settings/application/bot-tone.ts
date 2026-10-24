/** Keep the original four families as preferences; resolve collisions across the roster. */
const preferredTone = (id: string) =>
  id === "default"
    ? 0
    : id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;

export const botPalette = [
  { name: "Sage", color: "#b5c99b" },
  { name: "Lavender", color: "#b5b4dc" },
  { name: "Amber", color: "#e3b477" },
  { name: "Teal", color: "#83bcb4" },
  { name: "Rose", color: "#dda6b5" },
  { name: "Sky", color: "#91b7df" },
  { name: "Sand", color: "#d2ca86" },
  { name: "Clay", color: "#d5aa91" },
] as const;

export const botToneCount = botPalette.length;

/** Runtime roster order is stable creation order. Appending a bot never recolors older bots. */
export function botTones(
  ids: readonly string[],
  custom: ReadonlyMap<string, string> = new Map(),
) {
  const tones = new Map<string, number>();
  const usage = Array<number>(botToneCount).fill(0);
  for (const id of ["default", ...ids]) {
    if (tones.has(id)) continue;
    const chosen = custom.get(id)?.toLowerCase();
    if (chosen) {
      const index = botPalette.findIndex((entry) => entry.color === chosen);
      tones.set(id, index < 0 ? preferredTone(id) : index);
      if (index >= 0) usage[index]++;
      continue;
    }
    const preferred = preferredTone(id);
    let tone = preferred;
    for (let offset = 1; id !== "default" && offset < botToneCount; offset++) {
      const candidate = (preferred + offset) % botToneCount;
      if (usage[candidate] < usage[tone]) tone = candidate;
    }
    tones.set(id, tone);
    usage[tone]++;
  }
  return tones;
}

export function botTone(id: string, ids: readonly string[] = []) {
  return botTones([...ids, id]).get(id)!;
}

export function botColors(
  bots: readonly { id: string; color?: string | null }[],
) {
  const custom = new Map<string, string>();
  for (const bot of bots)
    if (bot.color) custom.set(bot.id, bot.color.toLowerCase());
  const tones = botTones(
    bots.map((bot) => bot.id),
    custom,
  );
  return new Map(
    [...tones].map(([id, tone]) => [
      id,
      custom.get(id) ?? botPalette[tone].color,
    ]),
  );
}

/** Keep the eyes visible even when the owner chooses a very dark body color. */
export function botEyeColor(color: string) {
  const channels = color
    .slice(1)
    .match(/../g)!
    .map((hex) => {
      const value = parseInt(hex, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.079
    ? "#ffffff"
    : "#273329";
}
