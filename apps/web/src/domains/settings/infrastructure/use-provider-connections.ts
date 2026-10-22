import type {
  EditProviderConnection,
  RuntimeSettings,
  SaveProviderConnection,
} from "@raphie/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

type Change =
  | { action: "add"; input: SaveProviderConnection }
  | { action: "edit"; id: string; input: EditProviderConnection }
  | { action: "remove"; id: string };

export function useProviderConnections() {
  const { workspace } = useBackend();
  const api = workspace.api;
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["provider-connections"],
    mutationFn: (change: Change) => {
      if (change.action === "add")
        return api<RuntimeSettings>("/api/settings/connections", change.input);
      const path = `/api/settings/connections/${encodeURIComponent(change.id)}`;
      return change.action === "edit"
        ? api<RuntimeSettings>(path, change.input)
        : api<RuntimeSettings>(`${path}/remove`, {});
    },
    onSuccess: (settings) => {
      client.setQueryData(["runtime-settings"], settings);
      void client.invalidateQueries({ queryKey: ["runtime-info"] });
    },
  });
}
