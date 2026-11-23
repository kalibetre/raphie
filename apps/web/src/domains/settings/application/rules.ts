export const MAX_RULES = 20;

export const MAX_RULE_LENGTH = 300;

/** Rules as they are edited: one a line. */
export const rulesText = (rules: readonly string[]) => rules.join("\n");

/** The rules in `text`: each line once, without a bullet, none empty. */
export function rulesOf(text: string) {
  const rules: string[] = [];
  for (const line of text.split("\n")) {
    const rule = line
      .replace(/\s+/g, " ")
      .replace(/^[-*•]\s+/, "")
      .trim();
    if (rule && !rules.includes(rule)) rules.push(rule);
  }
  return rules;
}

/** What stops `rules` from being saved, or "" when nothing does. */
export function rulesProblem(rules: readonly string[]) {
  if (rules.length > MAX_RULES)
    return `Keep to ${MAX_RULES} rules; there are ${rules.length}.`;
  const long = rules.findIndex((rule) => rule.length > MAX_RULE_LENGTH);
  return long < 0
    ? ""
    : `Rule ${long + 1} is over ${MAX_RULE_LENGTH} characters.`;
}

export const sameRules = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((rule, index) => rule === b[index]);
