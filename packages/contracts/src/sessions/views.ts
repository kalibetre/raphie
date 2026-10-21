import type {
  ActivityEvent,
  LiveConversation,
  Session,
  ToolApprovalView,
  Turn,
  WorkspaceSnapshot,
} from "../index.ts";

export type SessionSummary = Omit<Session, "id" | "discordThreadId"> & {
  id: string;
  origin: "web" | "discord";
  lastAt: number;
  working: boolean;
  failed: boolean;
  preview: string;
  turnCount: number;
  waiting: boolean;
};

export type SessionTurn = Omit<
  Turn,
  "conversationId" | "requestKey" | "fingerprint"
> & { conversationId: string };

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
  | "failed";

export type SessionObservation = {
  session: SessionSummary;
  turns: SessionTurn[];
  toolApprovals: SessionApproval[];
  live: LiveConversation | null;
  activity: SessionActivity[];
  nextBefore: string | null;
  phase: RunPhase;
  error: { code: "reply_failed"; message: string } | null;
};

export type RuntimeInfo = Pick<
  WorkspaceSnapshot,
  "model" | "mcp" | "uncertainToolDeliveries"
>;

/** Client-side composition of focused queries, never a runtime persistence snapshot. */
export type ClientWorkspace = RuntimeInfo & {
  conversations: SessionSummary[];
  turns: SessionTurn[];
  toolApprovals: SessionApproval[];
  live: Record<string, LiveConversation>;
  activity: SessionActivity[];
};
