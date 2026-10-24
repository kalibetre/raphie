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

export type SandboxInfo = {
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
