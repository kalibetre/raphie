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
};
