import type {
  SandboxInfo,
  SandboxSettings,
  SaveSandboxSettings,
} from "@raphie/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import type { BackendWorkspace } from "../../../infrastructure/http/backend-workspace";

export function sandboxQuery(workspace: BackendWorkspace) {
  return {
    queryKey: ["sandbox"],
    queryFn: () => workspace.api<SandboxInfo>("/api/workspace"),
    refetchInterval: 5000,
  };
}

export async function saveSandboxSettings(
  workspace: BackendWorkspace,
  input: SaveSandboxSettings,
) {
  const settings = await workspace.api<SandboxSettings>(
    "/api/workspace/settings",
    input,
  );
  workspace.queries.setQueryData<SandboxInfo>(["sandbox"], (info) =>
    info ? { ...info, settings } : info,
  );
  return settings;
}

export function useSandbox() {
  const { workspace } = useBackend();
  const query = useQuery(sandboxQuery(workspace));
  const save = useMutation({
    mutationFn: (input: SaveSandboxSettings) =>
      saveSandboxSettings(workspace, input),
    onError: () => {
      void query.refetch();
    },
  });
  return { ...query, save };
}

export function formatWorkspaceBytes(bytes: number | null) {
  if (bytes === null) return "Usage unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
