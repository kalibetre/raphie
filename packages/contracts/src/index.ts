/** Public read models. No runtime, framework, or persistence dependencies. */
export type { DiagnosticSpan, TraceDiagnostics } from "./diagnostics/views.ts";

export type Channel = "web" | "discord";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type Attachment = { id: string; name: string; size: number };

/** `provider` identifies the Pi provider instance for a specific connection. */
export type ModelSelection = { provider: string; modelId: string };

export type Session = {
  model?: ModelSelection;
  id: number;
  sessionId: string;
  title: string;
  discordThreadId: string | null;
  createdAt: number;
};

export type Turn = {
  id: string;
  requestKey: string;
  fingerprint: string;
  conversationId: number;
  source: Channel;
  text: string;
  createdAt: number;
  status: "pending" | "done" | "error";
  answer: string | null;
};

export type ConversationDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};

export type ToolApprovalView = {
  id: string;
  conversationId: number;
  server: string;
  tool: string;
  argumentsJson: string;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decidedVia: Channel | null;
  execution: "waiting" | "running" | "done" | "uncertain";
};

export type ActivityEvent = {
  id: number;
  at: number;
  attemptId: string;
  conversationId: number | null;
  runId: string | null;
  operationId: string | null;
  pluginId: string | null;
  type: string;
  summary: string;
  detailsJson: string;
};

export type LiveConversation = {
  text: string;
  generating: boolean;
  usage: unknown;
};

export type WorkspaceSnapshot = {
  conversations: Session[];
  turns: Turn[];
  deliveries: ConversationDelivery[];
  model: { provider: string; modelId: string } | null;
  mcp: {
    connected: boolean;
    error: boolean;
    server: string | null;
    toolCount: number;
  };
  toolApprovals: ToolApprovalView[];
  uncertainToolDeliveries: string[];
  live: Record<number, LiveConversation>;
  activity: ActivityEvent[];
};

export type {
  SessionSummary,
  SessionTurn,
  SessionApproval,
  SessionActivity,
  Page,
  RunPhase,
  SessionObservation,
  RuntimeInfo,
  ClientWorkspace,
} from "./sessions/views.ts";

export type {
  RuntimeSettings,
  UpdateRuntimeSettings,
  ProviderConnection,
  SaveProviderConnection,
  EditProviderConnection,
} from "./settings/views.ts";
