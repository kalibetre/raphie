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
  return status === "active" || status === "waiting" || status === "deferred";
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
  const reminder = item.reminderAt
    ? `; reminder at ${new Date(item.reminderAt).toISOString()}`
    : "";
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
  return `${item.id} ${flat(item.title)}: ${where}${job}${handoff}${running}${reminder}${last}`;
}

/** Put in-flight work first and deferred items after scheduled jobs. */
function rank(item: WorkItem) {
  if (item.status === "deferred") return 3;
  if (item.origin?.kind !== "job") return 0;
  return item.run ? 1 : 2;
}

/**
 * Open items in the order the bot should see them: its own requests, waits
 * and handoffs first, then jobs that are running, then the rest of its
 * scheduled jobs, then deferred items, each newest activity first.
 */
export function byAttention(a: WorkItem, b: WorkItem) {
  return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
}

/**
 * "…and 3 more of your own and 40 scheduled jobs: use work_list.", for the
 * items left out, ending with `hint`. Jobs past the end point to schedule_list.
 */
function moreLine(left: readonly WorkItem[], hint: string) {
  const jobs = left.filter((item) => item.origin?.kind === "job").length;
  const others = left.length - jobs;
  const plural = jobs === 1 ? "" : "s";
  const text =
    others && jobs
      ? `${others} more of your own and ${jobs} scheduled job${plural}`
      : others
        ? `${others} more`
        : `${jobs} more scheduled job${plural}`;
  return `…and ${text}: ${hint}.`;
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
    (left.length ? `\n${moreLine(left, "use work_list")}` : "") +
    "\n"
  );
}

/**
 * Open items in `byAttention` order, or closed ones newest activity first,
 * those matching `query` when given. The bot and the Work page see one order.
 */
export function listWork(
  items: readonly WorkItem[],
  filter: { open: boolean; deferred?: boolean; query?: string },
) {
  const query = filter.query?.trim().toLowerCase();
  return items
    .filter((item) => isOpen(item.status) === filter.open)
    .filter((item) => !filter.deferred || item.status === "deferred")
    .filter(
      (item) =>
        !query ||
        `${item.id} ${item.title} ${item.notes} ${item.result?.text ?? ""}`
          .toLowerCase()
          .includes(query),
    )
    .sort(filter.open ? byAttention : (a, b) => b.updatedAt - a.updatedAt);
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
  filter: { closed: boolean; deferred?: boolean; query?: string },
) {
  const all = listWork(items, { ...filter, open: !filter.closed });
  const shown = all.slice(0, MAX_TOOL_LISTED);
  const left = all.slice(shown.length);
  if (!shown.length)
    return `No ${filter.closed ? "closed" : filter.deferred ? "deferred" : "open"} work items${filter.query ? ` matching "${filter.query}"` : ""}.`;
  return (
    shown.map(workLine).join("\n") +
    (left.length
      ? `\n${moreLine(left, left.some((item) => item.origin?.kind === "job") ? "narrow it with query; schedule_list lists every job" : "narrow it with query")}`
      : "")
  );
}

/** A change to a work item: only the fields given change. */
export type WorkChange = {
  title?: string;
  status?: WorkStatus;
  waitingOn?: string;
  notes?: string;
  result?: string;
  reminderAt?: number | null;
};

export function reminderIssue(at: number, now: number) {
  if (!Number.isSafeInteger(at) || at > 8.64e15 || at <= now)
    return "Choose a reminder time in the future.";
}

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
  if (change.status === "deferred" && (item.origin || item.run))
    return `${item.id} can be deferred only when it belongs to this chat and has no background run in progress.`;
  if (change.reminderAt !== undefined && item.origin)
    return `${item.id} follows a handoff. Reminders belong to the chat's own work items.`;
  if (typeof change.reminderAt === "number") {
    if (!isOpen(change.status ?? item.status))
      return "A reminder needs an open work item.";
    const issue = reminderIssue(change.reminderAt, now);
    if (issue) return issue;
  }
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
  if (!isOpen(item.status) || change.reminderAt === null)
    delete item.reminderAt;
  else if (change.reminderAt !== undefined) item.reminderAt = change.reminderAt;
  item.updatedAt = now;
  return undefined;
}
