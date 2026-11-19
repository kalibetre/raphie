/** Public read models. No runtime, framework, or persistence dependencies. */
export type {
  BotMcpConnection,
  SaveMcpConnection,
  SaveScheduledJob,
  ScheduledJob,
  ScheduledJobRun,
} from "./bots/automation.ts";

export type {
  ChannelSettings,
  DiscordChannel,
  SaveTelegramChannel,
  TelegramChannel,
  TelegramPairingCode,
  TelegramProblem,
} from "./bots/channels.ts";

export type {
  BotProfile,
  SaveBotProfile,
  UpdateBotProfile,
} from "./bots/views.ts";

export type { DiagnosticSpan, TraceDiagnostics } from "./diagnostics/views.ts";

export type Channel = "web" | "discord" | "telegram";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  path?: string;
  mimeType?: string;
};

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

/** Why a reply ended without an answer. */
export type TurnFailure = {
  /** A plain sentence: what happened and what to do next. */
  message: string;
  /** The model provider's own error text, when there is one. */
  detail?: string;
};

export type Turn = {
  id: string;
  requestKey: string;
  fingerprint: string;
  conversationId: number;
  source: Channel;
  text: string;
  attachments?: Attachment[];
  createdAt: number;
  status: "pending" | "done" | "error";
  answer: string | null;
  queueMode?: "followUp" | "steer";
  cancelled?: boolean;
  /** Set when the turn failed (`status: "error"`, not cancelled). */
  failure?: TurnFailure;
  /** Set when a scheduled job, not the owner, started this turn. */
  scheduled?: { name: string };
  /** Set when another bot, not the owner, started this turn. */
  handoff?: TurnHandoff;
};

/**
 * A turn another bot started: a task it handed off to this bot, or the result
 * of a task this bot handed off, coming back.
 */
export type TurnHandoff = {
  id: string;
  kind: "task" | "result";
  /** The other bot: the one that handed the task off, or the one that did it. */
  bot: { id: string; name: string };
  title: string;
  /** How the task ended. Only on results. */
  outcome?: "completed" | "failed" | "cancelled";
};

export type ConversationDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};

export type ToolApprovalView = {
  connectionIdentity?: string;
  id: string;
  conversationId: number;
  server: string;
  tool: string;
  argumentsJson: string;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decidedVia: Channel | null;
  /** Decided in the desktop app rather than the browser. */
  decidedApp?: "desktop";
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
  ConnectionAuth,
  ConnectionProvider,
  SignInPrompt,
  SignInEvent,
  ProviderSignIn,
  StartProviderSignIn,
} from "./settings/views.ts";

export type {
  MemoryProvider,
  MemoryConfiguration,
  SaveMemoryConfiguration,
  MemoryEvidence,
  MemoryRecall,
  MemoryPage,
  MemoryReflection,
  MemoryStatus,
} from "./memory/views.ts";

export type {
  SandboxInfo,
  SandboxProvider,
  SandboxProviderInfo,
  SandboxSettings,
  SaveSandboxSettings,
  WorkspaceEntry,
  WorkspaceListing,
} from "./workspaces/views.ts";

export type {
  ChannelOrigin,
  HomeDestination,
  ChannelHomeSettings,
} from "./bots/channels.ts";
