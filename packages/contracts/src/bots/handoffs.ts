/** How a handed-off task, or one request in it, ended. */
export type HandoffOutcome = "completed" | "failed" | "cancelled";

/** One brief sent in a handoff: the first, or a follow-up. */
export type HandoffRequest = {
  brief: string;
  /** The turn in the sending session that sent this brief. */
  fromTurnId: string | null;
  sentAt: number;
  /** The turn it started in the other bot, once delivered. */
  turnId: string | null;
  finishedAt: number | null;
  outcome: HandoffOutcome | null;
};

/** A task this bot handed off to another bot, read from the bot that sent it. */
export type Handoff = {
  id: string;
  /** The bot doing the task. */
  to: { id: string; name: string };
  title: string;
  /** This bot's session the task came from; results return there. */
  fromSessionId: string;
  /** The task's session in the other bot, once delivered. */
  toSessionId: string | null;
  /** Working while any request is unfinished, else how the latest ended. */
  status: "working" | HandoffOutcome;
  createdAt: number;
  requests: HandoffRequest[];
  /** The other bot is waiting for the owner's approval. Read live, never stored. */
  waiting?: boolean;
};
