/** Who opened, changed or closed a work item. */
export type WorkActor = "bot" | "owner";

/**
 * Where a work item stands: `active` while the bot works on it, `waiting`
 * while it is blocked on `waitingOn`, and `done` or `dropped` once closed.
 */
export type WorkStatus = "active" | "waiting" | "done" | "dropped";

/** Something a bot is keeping track of for longer than one turn. */
export type WorkItem = {
  /** Short and stable, such as "w-12". */
  id: string;
  title: string;
  status: WorkStatus;
  /** While waiting: on whom or what, in a few words. */
  waitingOn?: string;
  /** The chat message (turn) that started it, when there is one. */
  sourceTurnId?: string;
  /** The bot's short running notes. */
  notes: string;
  /** The latest result, and the chat turn that carried it. */
  result?: { text: string; at: number; turnId?: string };
  opened: { at: number; by: WorkActor };
  /** When it last changed. */
  updatedAt: number;
  closed?: { at: number; by: WorkActor };
};
