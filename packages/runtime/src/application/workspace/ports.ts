import type { WorkspaceSnapshot } from "@raphie/contracts";

export type ReadWorkspace = () => Promise<WorkspaceSnapshot>;
