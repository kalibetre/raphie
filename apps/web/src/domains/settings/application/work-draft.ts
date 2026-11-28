import type { WorkStatus } from "@raphie/contracts";

/** What the owner changes on a work item; only the fields given change. */
export type WorkChange = {
  title?: string;
  notes?: string;
  status?: WorkStatus;
  reminderAt?: number | null;
};

/**
 * The item being written: a new one, or an open one being edited, with the
 * values it opened with so a save sends only what changed.
 */
export type Draft = {
  id?: string;
  title: string;
  notes: string;
  deferred?: boolean;
  reminder?: string;
  started?: { title: string; notes: string; reminder?: string };
};

/** The local date and time HTML's datetime-local input displays. */
export function reminderInput(at: number | undefined) {
  if (at === undefined) return "";
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .replace(/:\d{2}\.\d{3}Z$/, "");
}

/** For an edit, send only the fields the owner changed. */
export function changed(draft: Draft): WorkChange | undefined {
  const reminderAt = draft.reminder ? new Date(draft.reminder).getTime() : null;
  if (!draft.started)
    return {
      title: draft.title,
      notes: draft.notes,
      ...(draft.deferred ? { status: "deferred" } : {}),
      ...(reminderAt === null ? {} : { reminderAt }),
    };
  const change: WorkChange = {};
  if (draft.title.trim() !== draft.started.title.trim())
    change.title = draft.title;
  if (draft.notes.trim() !== draft.started.notes.trim())
    change.notes = draft.notes;
  if (draft.reminder !== draft.started.reminder) change.reminderAt = reminderAt;
  return Object.keys(change).length ? change : undefined;
}
