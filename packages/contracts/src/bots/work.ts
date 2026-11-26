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
  /**
   * Where it came from, when not from the chat: a scheduled job, or a task
   * handed to another bot (`handoff-sent`) or from one (`handoff-received`).
   */
  origin?:
    | { kind: "job"; jobId: string }
    | {
        kind: "handoff-sent" | "handoff-received";
        handoffId: string;
        /** The other bot: the one it was handed to, or the one it came from. */
        bot: { id: string; name: string };
      };
  /** When it next wakes on its own: a job's next run. */
  nextAt?: number;
  /** Its own background session, once work has run there. */
  sessionId?: string;
  /** The run in progress, if any: which, since when, and its turn once delivered. */
  run?: { id?: string; startedAt: number; turnId?: string };
  opened: { at: number; by: WorkActor };
  /** When it last changed. */
  updatedAt: number;
  closed?: { at: number; by: WorkActor };
};
