import type { WorkItem, WorkStatus } from "@raphie/contracts";

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
  const where =
    item.status === "waiting"
      ? `waiting on ${item.waitingOn || "something"}`
      : item.status;
  const last = item.result
    ? `; last: ${clip(item.result.text.replace(/\s+/g, " "), 100)} (${day(item.result.at)})`
    : "";
  return `${item.id} ${item.title}: ${where}${last}`;
}

/**
 * The open items, sent with each of the chat's messages: newest activity
 * first, at most `MAX_LISTED` and about 1,500 tokens, saying how many more
 * there are. Empty when nothing is open.
 */
export function openWorkContext(items: readonly WorkItem[]) {
  const open = items
    .filter((item) => isOpen(item.status))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!open.length) return "";
  const lines: string[] = [];
  let size = 0;
  for (const item of open.slice(0, MAX_LISTED)) {
    const line = workLine(item);
    if (size + line.length > MAX_LIST_CHARS) break;
    lines.push(line);
    size += line.length + 1;
  }
  const more = open.length - lines.length;
  return (
    `[Open work (${open.length}); work_read shows one in full]\n` +
    lines.join("\n") +
    (more ? `\n…and ${more} more: use work_list.` : "") +
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
