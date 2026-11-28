/** A tool step as the phrases need it. */
type Step = { tool: string; server?: string; connection?: string };

/**
 * What a bot did with one built-in tool, in its own words: what it did,
 * and what it is doing while the tool runs.
 */
const phrases: Record<string, [done: string, doing: string]> = {
  memory_retain: [
    "Noted something to remember",
    "Noting something to remember",
  ],
  memory_revise: ["Updated a note", "Updating a note"],
  memory_forget: ["Forgot a note", "Forgetting a note"],
  memory_recall: ["Checked what I remember", "Checking what I remember"],
  memory_reflect: [
    "Thought over what I remember",
    "Thinking over what I remember",
  ],
  schedule_create: ["Scheduled a job", "Scheduling a job"],
  schedule_update: ["Updated a scheduled job", "Updating a scheduled job"],
  schedule_delete: ["Removed a scheduled job", "Removing a scheduled job"],
  schedule_list: ["Checked the schedule", "Checking the schedule"],
  work_open: [
    "Started keeping track of this",
    "Starting to keep track of this",
  ],
  work_update: ["Updated a work item", "Updating a work item"],
  work_close: ["Closed a work item", "Closing a work item"],
  work_start: ["Started on it in the background", "Starting on it"],
  work_read: ["Checked a work item", "Checking a work item"],
  work_list: ["Checked my work items", "Checking my work items"],
  web_search: ["Searched the web", "Searching the web"],
  read_document: ["Read a document", "Reading a document"],
  read_skill: ["Read a skill", "Reading a skill"],
  save_skill: ["Saved a skill", "Saving a skill"],
  handoff_create: ["Handed off a task", "Handing off a task"],
  handoff_follow_up: ["Followed up on a handoff", "Following up on a handoff"],
  handoff_list: ["Checked on handed-off work", "Checking on handed-off work"],
  handoff_read: ["Checked on handed-off work", "Checking on handed-off work"],
  update_owner_profile: [
    "Updated what I know about you",
    "Updating what I know about you",
  ],
  update_personality: ["Updated my personality", "Updating my personality"],
  update_instructions: ["Updated my instructions", "Updating my instructions"],
  save_rule: ["Updated my standing rules", "Updating my standing rules"],
  workspace_exec: ["Ran a command", "Running a command"],
  bash: ["Ran a command", "Running a command"],
};

/**
 * Tools that are how the bot works, not what it did for the owner: finding
 * its own tools, and showing a card the reply already shows. Their details
 * stay with the technical ones.
 */
const plumbing = new Set(["tool_search", "show_card", "ask_owner"]);

export function isPlumbing(step: Step) {
  return !step.server && !step.connection && plumbing.has(step.tool);
}

/**
 * A connected service's tool, sorted by what it does from the words in its
 * name; anything else just used the service.
 */
const kinds: [RegExp, done: string, doing: string][] = [
  [/^(search|query|find|lookup)$/, "Searched", "Searching"],
  [
    /^(list|get|read|fetch|view|show|describe|check|skills)$/,
    "Checked",
    "Checking",
  ],
  [/^(create|add|new|insert|upload)$/, "Added to", "Adding to"],
  [
    /^(update|edit|set|modify|rename|move|label|mark|apply|configure)$/,
    "Updated",
    "Updating",
  ],
  [
    /^(delete|remove|trash|archive|unlink|cancel)$/,
    "Cleaned up",
    "Cleaning up",
  ],
  [
    /^(send|post|reply|comment|forward|publish|share)$/,
    "Sent to",
    "Sending to",
  ],
];

function serviceKind(step: Step) {
  const words = step.tool.toLowerCase().split(/[^a-z0-9]+/);
  return kinds.find(([pattern]) => words.some((w) => pattern.test(w)));
}

/** The service's name when it has none of its own: its namespace in words. */
export function serviceName(step: Step, named?: string) {
  if (named) return named;
  const raw = step.server ?? "a connected service";
  return raw[0].toUpperCase() + raw.slice(1).replaceAll("_", " ");
}

/** One tool step in words: what the bot did. */
export function toolPhrase(step: Step, service?: string) {
  const own = !step.server && !step.connection && phrases[step.tool];
  if (own) return own[0];
  if (!step.server && !step.connection) return `Used ${step.tool}`;
  const name = serviceName(step, service);
  const kind = serviceKind(step);
  return kind ? `${kind[1]} ${name}` : `Used ${name}`;
}

/** One running tool step in words: what the bot is doing. */
export function toolDoing(step: Step, service?: string) {
  const own = !step.server && !step.connection && phrases[step.tool];
  if (own) return own[1];
  if (isPlumbing(step)) return "Getting ready";
  if (!step.server && !step.connection) return `Using ${step.tool}`;
  const name = serviceName(step, service);
  const kind = serviceKind(step);
  return kind ? `${kind[2]} ${name}` : `Using ${name}`;
}

/** A connected tool's own name in words, without its namespace. */
export function toolWords(step: Step) {
  return step.tool
    .replace(/_[0-9a-f]{8}$/, "")
    .replaceAll(/[_-]+/g, " ")
    .trim();
}

/**
 * A finished turn's tools in one line: each distinct phrase once, in order,
 * the first two named and the rest counted.
 */
export function stepsSummary<S extends Step>(
  steps: S[],
  service?: (step: S) => string | undefined,
) {
  // Later phrases continue the sentence, so they start in lower case.
  const said = [
    ...new Set(steps.map((step) => toolPhrase(step, service?.(step)))),
  ].map((phrase, i) =>
    i ? phrase[0].toLowerCase() + phrase.slice(1) : phrase,
  );
  if (said.length <= 2) return said.join(" and ");
  return `${said.slice(0, 2).join(", ")} and ${said.length - 2} more`;
}
