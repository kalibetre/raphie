import type { SandboxInfo } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useSandbox() {
  const { workspace } = useBackend();
  return useQuery({
    queryKey: ["sandbox"],
    queryFn: () => workspace.api<SandboxInfo>("/api/workspace"),
    refetchInterval: 5000,
  });
}

export function formatWorkspaceBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
