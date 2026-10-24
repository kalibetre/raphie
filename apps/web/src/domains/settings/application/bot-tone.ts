/** Keep the original four families as preferences; resolve collisions across the roster. */
const preferredTone = (id: string) =>
  id === "default"
    ? 0
    : id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;

export const botToneCount = 8;

/** Runtime roster order is stable creation order. Appending a bot never recolors older bots. */
export function botTones(ids: readonly string[]) {
  const tones = new Map([["default", 0]]);
  const usage = Array<number>(botToneCount).fill(0);
  usage[0] = 1;
  for (const id of ids) {
    if (tones.has(id)) continue;
    const preferred = preferredTone(id);
    let tone = preferred;
    for (let offset = 1; offset < botToneCount; offset++) {
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
