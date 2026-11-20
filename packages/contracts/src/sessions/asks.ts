import type { Channel } from "../index.ts";

/** One answer the owner can pick. */
export type AskOption = { label: string; detail?: string };

/** The owner's answer: one of the options by position, or their own words. */
export type AskAnswer = { choice: number } | { text: string };

export type AskStatus = "pending" | "answered" | "expired";

/**
 * A question a bot asked the owner mid-turn. The turn waits for the answer,
 * which goes back to the bot as the result of its `ask_owner` call.
 */
export type SessionAsk = {
  id: string;
  conversationId: string;
  /** The turn that is waiting. */
  turnId: string;
  question: string;
  options: AskOption[];
  /** The first option deletes, sends or spends something. */
  danger?: true;
  createdAt: number;
  expiresAt: number;
  /** "expired" also covers a turn that stopped before an answer. */
  status: AskStatus;
  answer: AskAnswer | null;
  answeredVia: Channel | null;
  answeredApp?: "desktop";
};
