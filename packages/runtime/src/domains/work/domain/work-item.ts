import type { WorkActor, WorkItem, WorkStatus } from "@raphie/contracts";

/** The most open items listed with each message; `work_list` shows the rest. */
export const MAX_LISTED = 20;

/** About 1,500 tokens: the most the list adds to a message. */
const MAX_LIST_CHARS = 6_000;

export const LIMITS = {
  title: 80,
  waitingOn: 120,
  notes: 2_000,
  result: 2_000,
};

export function isOpen(status: WorkStatus) {
  return status === "active" || status === "waiting";
}

/** The next id after every one given so far: "w-1", "w-2", … */
export function workId(next: number) {
  return `w-${next}`;
}

/** Text cut to `max` characters, with an ellipsis when cut. */
export function clip(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function day(at: number) {
  return new Date(at).toISOString().slice(0, 10);
}

/** One item as a line of the list: id, title, where it stands, its last result. */
export function workLine(item: WorkItem) {
  // One line each: text with line breaks can't start a header line of its own.
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const where =
    item.status === "waiting"
      ? `waiting on ${flat(item.waitingOn || "something")}`
      : item.status;
  const last = item.result
    ? `; last: ${clip(item.result.text.replace(/\s+/g, " "), 100)} (${day(item.result.at)})`
    : "";
  const running = item.run ? "; working on it in the background" : "";
  const job =
    item.origin?.kind === "job"
      ? `; scheduled job${item.nextAt ? `, next run ${new Date(item.nextAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`
      : "";
  const handoff =
    item.origin?.kind === "handoff-sent"
      ? `; handed to ${item.origin.bot.name} (handoff ${item.origin.handoffId})`
      : item.origin?.kind === "handoff-received"
        ? `; a task from ${item.origin.bot.name}`
        : "";
  return `${item.id} ${flat(item.title)}: ${where}${job}${handoff}${running}${last}`;
}

/** 0 for the bot's own items, 1 for a job's running item, 2 for an idle job's. */
function rank(item: WorkItem) {
  if (item.origin?.kind !== "job") return 0;
  return item.run ? 1 : 2;
}

/**
 * Open items in the order the bot should see them: its own requests, waits
 * and handoffs first, then jobs that are running, then the rest of its
 * scheduled jobs, each newest activity first. A bot with many jobs still sees
 * what it is chasing for the owner.
 */
export function byAttention(a: WorkItem, b: WorkItem) {
  return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
}

/** "…and 3 more and 40 scheduled jobs: use work_list.", for the items left out. */
function moreLine(left: readonly WorkItem[]) {
  const jobs = left.filter((item) => item.origin?.kind === "job").length;
  const others = left.length - jobs;
  const jobText = `${jobs} scheduled job${jobs === 1 ? "" : "s"}`;
  const text =
    others && jobs
      ? `${others} more and ${jobText}`
      : others
        ? `${others} more`
        : `${jobs} more scheduled job${jobs === 1 ? "" : "s"}`;
  return `…and ${text}: use work_list.`;
}

/**
 * The open items, sent with each of the chat's messages, in `byAttention`
 * order: at most `MAX_LISTED` and about 1,500 tokens, saying how many more
 * there are. Empty when nothing is open.
 */
export function openWorkContext(items: readonly WorkItem[]) {
  const open = items.filter((item) => isOpen(item.status)).sort(byAttention);
  if (!open.length) return "";
  const lines: string[] = [];
  let size = 0;
  for (const item of open.slice(0, MAX_LISTED)) {
    const line = workLine(item);
    if (size + line.length > MAX_LIST_CHARS) break;
    lines.push(line);
    size += line.length + 1;
  }
  const left = open.slice(lines.length);
  return (
    `[Open work (${open.length}); work_read shows one in full]\n` +
    lines.join("\n") +
    (left.length ? `\n${moreLine(left)}` : "") +
    "\n"
  );
}

/** Open or closed items, newest activity first, those matching `query` when given. */
export function listWork(
  items: readonly WorkItem[],
  filter: { open: boolean; query?: string },
) {
  const query = filter.query?.trim().toLowerCase();
  return items
    .filter((item) => isOpen(item.status) === filter.open)
    .filter(
      (item) =>
        !query ||
        `${item.id} ${item.title} ${item.notes} ${item.result?.text ?? ""}`
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The most items `work_list` shows at once. */
const MAX_TOOL_LISTED = 50;

/**
 * What `work_list` answers: open items in `byAttention` order or closed ones
 * newest first, those matching `query` when given, at most
 * `MAX_TOOL_LISTED` and how many more there are.
 */
export function workListText(
  items: readonly WorkItem[],
  filter: { closed: boolean; query?: string },
) {
  const all = listWork(items, { open: !filter.closed, query: filter.query });
  if (!filter.closed) all.sort(byAttention);
  const shown = all.slice(0, MAX_TOOL_LISTED);
  const more = all.length - shown.length;
  if (!shown.length)
    return `No ${filter.closed ? "closed" : "open"} work items${filter.query ? ` matching "${filter.query}"` : ""}.`;
  return (
    shown.map(workLine).join("\n") +
    (more ? `\n…and ${more} more: narrow it with query.` : "")
  );
}

/** A change to a work item: only the fields given change. */
export type WorkChange = {
  title?: string;
  status?: WorkStatus;
  waitingOn?: string;
  notes?: string;
  result?: string;
};

/**
 * Applies `change` to `item` as `by` makes it, or says why not. A closed item
 * takes no changes, except the owner reopening it; closing records who did.
 */
export function changeWork(
  item: WorkItem,
  change: WorkChange,
  by: WorkActor,
  now: number,
): string | undefined {
  if (item.origin?.kind === "job")
    return by === "owner"
      ? `${item.id} follows a scheduled job. Change, pause or remove the job under Scheduled jobs.`
      : `${item.id} follows a scheduled job. Change, pause or remove the job with the schedule tools.`;
  const reopening =
    !isOpen(item.status) &&
    change.status !== undefined &&
    isOpen(change.status);
  // A handoff's item reopens with its next request, not by hand.
  if (reopening && item.origin?.kind === "handoff-sent")
    return `${item.id} is a task handed to ${item.origin.bot.name}. It reopens when ${by === "owner" ? "the bot sends" : "you send"} a follow-up with handoff_follow_up.`;
  if (reopening && item.origin?.kind === "handoff-received")
    return `${item.id} is a task from ${item.origin.bot.name}. It reopens when ${item.origin.bot.name} follows up.`;
  if (!isOpen(item.status) && !(reopening && by === "owner"))
    return by === "owner"
      ? `${item.id} is ${item.status}. Reopen it to change it.`
      : `${item.id} is ${item.status}. Open a new item if the work starts again.`;
  if (change.title !== undefined) {
    const title = clip(change.title, LIMITS.title);
    if (!title) return "A work item needs a title.";
    item.title = title;
  }
  if (change.status) item.status = change.status;
  if (item.status === "waiting") {
    if (change.waitingOn !== undefined)
      item.waitingOn = clip(change.waitingOn, LIMITS.waitingOn);
  } else delete item.waitingOn;
  if (change.notes !== undefined) item.notes = clip(change.notes, LIMITS.notes);
  if (change.result)
    item.result = { text: clip(change.result, LIMITS.result), at: now };
  if (isOpen(item.status)) delete item.closed;
  else if (!item.closed) item.closed = { at: now, by };
  item.updatedAt = now;
  return undefined;
}
