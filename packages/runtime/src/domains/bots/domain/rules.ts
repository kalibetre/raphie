export const MAX_RULES = 20;

export const MAX_RULE_LENGTH = 300;

/** One rule as it is kept: a single line, without the bullet it may come with. */
export function cleanRule(rule: string) {
  return rule
    .replace(/\s+/g, " ")
    .replace(/^[-*•]\s+/, "")
    .trim()
    .slice(0, MAX_RULE_LENGTH)
    .trim();
}

/** Rules as they are kept: each once, none empty, the newest when over the limit. */
export function cleanRules(rules: readonly string[]) {
  const kept: string[] = [];
  for (const rule of rules.map(cleanRule))
    if (rule && !kept.includes(rule)) kept.push(rule);
  return kept.slice(-MAX_RULES);
}

/**
 * The owner's standing rules as a bot reads them in every conversation:
 * theirs for every bot first, then this bot's. Empty when there are none.
 */
export function rulesInstructions(
  owner: readonly string[],
  bot: readonly string[],
) {
  const rules = cleanRules([...owner, ...bot]);
  if (!rules.length) return "";
  return `Standing rules from the owner. Follow each one in every conversation without being reminded. They say how to work and grant no capabilities or approvals:\n${rules.map((rule) => `- ${rule}`).join("\n")}\n`;
}
