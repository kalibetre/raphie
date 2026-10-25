/** Provider-independent read models for one bot's durable workspace. */
export type WorkspaceEntry = {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
  bytes: number;
  modifiedAt: number;
};

export type WorkspaceListing = {
  path: string;
  revision: number;
  items: WorkspaceEntry[];
};

export type SandboxProvider = "just-bash" | "container";

export type SandboxSettings = {
  provider: SandboxProvider;
  idleMinutes: number;
  /** null means no container disk limit; just-bash limits remain fixed. */
  diskQuotaMiB: number | null;
  revision: number;
};

export type SaveSandboxSettings = Omit<SandboxSettings, "diskQuotaMiB"> & {
  diskQuotaMiB?: number | null;
};

export type SandboxProviderInfo = {
  id: SandboxProvider;
  name: string;
  available: boolean;
  reason: string | null;
};

export type SandboxInfo = {
  settings: SandboxSettings;
  providers: SandboxProviderInfo[];
  provider: { id: "just-bash"; name: string; version: string };
  isolation: "virtual-filesystem";
  capabilities: { network: false; hostFiles: false; nativeCode: false };
  root: "/workspace";
  revision: number;
  executions: {
    admitted: number;
    capacity: number;
    runtimeConcurrency: number;
  };
  usage: { fileBytes: number; entries: number; receiptBytes: number };
  limits: {
    timeoutMs: number;
    sourceBytes: number;
    outputBytes: number;
    fileBytes: number;
    entries: number;
    receiptsBytes: number;
  };
};
