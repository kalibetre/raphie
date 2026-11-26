import type { WorkStatus } from "@raphie/contracts";

/** What the owner changes on a work item; only the fields given change. */
export type WorkChange = {
  title?: string;
  notes?: string;
  status?: WorkStatus;
};

/**
 * The item being written: a new one, or an open one being edited, with the
 * title and notes it opened with so a save sends only what changed.
 */
export type Draft = {
  id?: string;
  title: string;
  notes: string;
  started?: { title: string; notes: string };
};

/** For an edit, only the title and notes the owner changed. */
export function changed(draft: Draft): WorkChange | undefined {
  if (!draft.started) return { title: draft.title, notes: draft.notes };
  const change: WorkChange = {};
  if (draft.title.trim() !== draft.started.title.trim())
    change.title = draft.title;
  if (draft.notes.trim() !== draft.started.notes.trim())
    change.notes = draft.notes;
  return Object.keys(change).length ? change : undefined;
}
