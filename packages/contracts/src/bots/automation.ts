export type McpTransport = "http" | "stdio";

export type SaveMcpConnection = {
  name: string;
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
  startedAt: number;
  finishedAt: number | null;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  sessionId: string | null;
  turnId: string | null;
  acknowledgedAt: number | null;
};
