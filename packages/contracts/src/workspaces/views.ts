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
  provider: { id: SandboxProvider; name: string; version: string };
  isolation: "virtual-filesystem" | "container";
  capabilities: { network: boolean; hostFiles: false; nativeCode: boolean };
  root: "/workspace";
  revision: number;
  executions: {
    admitted: number;
    capacity: number;
    runtimeConcurrency: number;
  };
  usage: {
    fileBytes: number;
    entries: number | null;
    receiptBytes: number | null;
  };
  limits: {
    timeoutMs: number;
    sourceBytes: number;
    outputBytes: number;
    fileBytes: number | null;
    entries: number | null;
    receiptsBytes: number | null;
  };
};
