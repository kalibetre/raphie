export type McpTransport = "http" | "stdio";

export type SaveMcpConnection = {
  name: string;
  /** What the bot should use it for, in the owner's words. */
  purpose?: string;
  transport: McpTransport;
  url?: string;
  token?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type BotMcpConnection = {
  source?: "environment" | "saved";
  id: string;
  name: string;
  /**
   * What the bot should use it for, in the owner's words: the bot reads it
   * in every conversation, beside the connection's name.
   */
  purpose?: string;
  /** One line the service says about itself, when it says anything. */
  summary?: string;
  transport: McpTransport;
  address: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  credentialConfigured: boolean;
  authorizationUrl?: string;
  authorizationFailed?: boolean;
};

export type SaveScheduledJob = {
  name: string;
  prompt: string;
  everyMinutes: number | null;
  firstRunAt: number;
};

export type ScheduledJob = SaveScheduledJob & {
  id: string;
  enabled: boolean;
  nextRunAt: number;
  sessionId: string | null;
  lastRunAt: number | null;
  lastStatus: "submitted" | "failed" | null;
  lastRun?: ScheduledJobRun;
};

export type ScheduledJobRun = {
  id: string;
  jobId: string;
  name: string;
  scheduledFor: number;
  late?: boolean;
  waitingForBot?: boolean;
  failureReason?: "unknown" | "no_model";
  startedAt: number;
  finishedAt: number | null;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  sessionId: string | null;
  turnId: string | null;
  acknowledgedAt: number | null;
};
