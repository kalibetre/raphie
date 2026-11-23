/** What a bot did with one tool, in its own words and the past tense. */
const phrases: Record<string, string> = {
  memory_retain: "Noted something to remember",
  memory_revise: "Updated a note",
  memory_forget: "Forgot a note",
  memory_recall: "Checked what I remember",
  memory_reflect: "Thought over what I remember",
  schedule_create: "Scheduled a job",
  schedule_update: "Updated a scheduled job",
  schedule_delete: "Removed a scheduled job",
  schedule_list: "Checked the schedule",
  web_search: "Searched the web",
  read_document: "Read a document",
  read_skill: "Read a skill",
  handoff_create: "Handed off a task",
  handoff_follow_up: "Followed up on a handoff",
  handoff_list: "Checked on handed-off work",
  handoff_read: "Checked on handed-off work",
  update_owner_profile: "Updated what I know about you",
  update_personality: "Updated my personality",
  update_instructions: "Updated my instructions",
  save_rule: "Updated my standing rules",
  workspace_exec: "Ran a command",
  bash: "Ran a command",
};

/** One tool step in words: a built-in tool's phrase, or the service used. */
export function toolPhrase(step: { tool: string; server?: string }) {
  return (
    phrases[step.tool] ??
    (step.server ? `Used ${step.server}` : `Used ${step.tool}`)
  );
}

/**
 * A finished turn's tools in one line: each distinct phrase once, in order,
 * the first two named and the rest counted.
 */
export function stepsSummary(steps: { tool: string; server?: string }[]) {
  // Later phrases continue the sentence, so they start in lower case.
  const said = [...new Set(steps.map(toolPhrase))].map((phrase, i) =>
    i ? phrase[0].toLowerCase() + phrase.slice(1) : phrase,
  );
  if (said.length <= 2) return said.join(", ");
  return `${said.slice(0, 2).join(", ")} and ${said.length - 2} more`;
}
