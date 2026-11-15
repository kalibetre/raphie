import type {
  Attachment,
  Channel as Source,
  ChannelOrigin,
  ModelSelection,
} from "@raphie/contracts";

import type { ReplyDestination } from "../../channels/domain/binding.ts";

export type ChatConversation = {
  model?: ModelSelection;
  id: number;
  sessionId: string;
  title: string;
  createdAt: number;
  /** Completed replies the owner has read, in any client; absent means none. */
  readReplyCount?: number;
};

/**
 * Where a read marker moves to: never backwards, so a client that read less
 * cannot undo another's reading, and never past the replies that exist.
 */
export function nextReadReplyCount(
  stored: number | undefined,
  reported: number,
  replies: number,
) {
  return Math.max(stored ?? 0, Math.min(reported, replies));
}

export type ChatTurn = {
  id: string;
  requestKey: string;
  fingerprint: string;
  conversationId: number;
  source: Source;
  text: string;
  origin?: ChannelOrigin;
  attachments?: Attachment[];
  createdAt: number;
  status: "pending" | "done" | "error";
  answer: string | null;
  submissionId?: string;
  queueMode?: "followUp" | "steer";
  cancelled?: boolean;
  answerEntryId?: string;
  replyTo?: ReplyDestination | null;
  discordUserId?: string;
  /** Started by a scheduled job; its text is the saved instruction. */
  scheduled?: { name: string };
  scheduledDelivery?: "home" | "web-only" | "home-unavailable";
};

export type ChatDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  connectionId?: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};
