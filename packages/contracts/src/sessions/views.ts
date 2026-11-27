import type { ChannelOrigin } from "../bots/channels.ts";
import type {
  ActivityEvent,
  Channel,
  LiveConversation,
  Session,
  ToolApprovalView,
  Turn,
  WorkspaceSnapshot,
} from "../index.ts";
import type { SessionAsk } from "./asks.ts";
import type { SessionCard } from "./cards.ts";

export type SessionSummary = Omit<Session, "id" | "discordThreadId"> & {
  id: string;
  origin: Channel;
  lastAt: number;
  working: boolean;
  failed: boolean;
  preview: string;
  turnCount: number;
  /** Completed assistant replies; optional for older runtimes. */
  replyCount?: number;
  replyPreview?: string;
  /** Identifier of the latest completed reply, when supported by the runtime. */
  replyTurnId?: string;
  /** Completed replies the owner has read in any client; optional for older runtimes. */
  readReplyCount?: number;
  waiting: boolean;
  /** A bot is waiting for the owner to answer a question; optional for older runtimes. */
  asking?: boolean;
  /** How many questions and approvals wait on the owner here. */
  pending: number;
  /** How many of them are questions; the rest are approvals. */
  questions: number;
  /** The work item whose own session this is; the chat's dock asks for it. */
  work?: string;
  /** The bot that handed this session's task off, and its session it came from. */
  handedOffBy?: { id: string; name: string; sessionId?: string };
  /** The session behind the bot's one chat with the owner; optional for older runtimes. */
  chat?: true;
};

export type SessionTurn = Omit<
  Turn,
  "conversationId" | "requestKey" | "fingerprint"
> & {
  conversationId: string;
  origin?: ChannelOrigin;
  scheduledDelivery?: "home" | "web-only" | "home-unavailable";
};

export type SessionApproval = Omit<ToolApprovalView, "conversationId"> & {
  conversationId: string;
};

export type SessionActivity = Omit<ActivityEvent, "conversationId"> & {
  conversationId: string | null;
};

export type Page<T> = { items: T[]; next: string | null };

export type RunPhase =
  | "idle"
  | "queued"
  | "model"
  | "writing"
  | "tool"
  | "approval"
  /** A bot's question is waiting for the owner's answer. */
  | "question"
  | "failed";

/**
 * What one piece of the bot's background work waits on the owner for: its
 * pending approvals and questions, with the work item it belongs to. `asks`
 * also holds the questions settled in the last day, for the chat's receipts.
 */
export type BackgroundRequest = {
  itemId: string;
  title: string;
  /** The item's own session, where the work runs. */
  sessionId: string;
  toolApprovals: SessionApproval[];
  asks: SessionAsk[];
};

export type SessionObservation = {
  session: SessionSummary;
  turns: SessionTurn[];
  toolApprovals: SessionApproval[];
  /** Questions the bot asked; optional for older runtimes. */
  asks?: SessionAsk[];
  /** Cards the bot showed; optional for older runtimes. */
  cards?: SessionCard[];
  live: LiveConversation | null;
  activity: SessionActivity[];
  nextBefore: string | null;
  phase: RunPhase;
  error: { code: "reply_failed"; message: string } | null;
  /** In the bot's chat: what its background work waits on the owner for. */
  background?: BackgroundRequest[];
};

export type RuntimeInfo = Pick<
  WorkspaceSnapshot,
  "model" | "mcp" | "uncertainToolDeliveries"
> & { identity?: { id: string; directory: string; kind?: "fixture" } };

/** Client-side composition of focused queries, never a runtime persistence snapshot. */
export type ClientWorkspace = RuntimeInfo & {
  conversations: SessionSummary[];
  turns: SessionTurn[];
  toolApprovals: SessionApproval[];
  asks: SessionAsk[];
  cards: SessionCard[];
  live: Record<string, LiveConversation>;
  activity: SessionActivity[];
  /** What the bot's background work waits on the owner for, in its chat. */
  background?: BackgroundRequest[];
};
