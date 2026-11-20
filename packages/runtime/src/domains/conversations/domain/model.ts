import type {
  Attachment,
  Channel as Source,
  ChannelOrigin,
  ModelSelection,
  ReadSession,
  TurnCompaction,
  TurnFailure,
  TurnHandoff,
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
  /** When the owner archived it. A new message brings it back. */
  archivedAt?: number;
  /** The bot that handed this session's task off. Only that bot directs it. */
  handedOffBy?: { id: string; name: string; sessionId?: string };
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
  /** Why the reply failed, when it did. */
  failure?: TurnFailure;
  answerEntryId?: string;
  replyTo?: ReplyDestination | null;
  discordUserId?: string;
  /** Started by a scheduled job; its text is the saved instruction. */
  scheduled?: { name: string };
  scheduledDelivery?: "home" | "web-only" | "home-unavailable";
  /** Started by another bot; its text is that bot's brief or result. */
  handoff?: TurnHandoff;
  /** Other bots' sessions the reply read, for tasks it handed off. */
  readSessions?: ReadSession[];
  /** Earlier messages were summarized during this turn. */
  compaction?: TurnCompaction;
};

export type ChatDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  connectionId?: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};
