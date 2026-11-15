import type { RuntimeSettings } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

/**
 * Trace collection is one switch for the whole backend. The runtime keeps it
 * with the default bot's settings, so it is read and written there whichever
 * bot is selected.
 */
const path = "/api/bots/default/settings";

export function useTelemetry() {
  const { workspace } = useBackend();
  const api = workspace.api;
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["telemetry-settings"],
    queryFn: () => api<RuntimeSettings>(path),
    retry: false,
  });
  const update = useMutation({
    mutationFn: (telemetryEnabled: boolean) =>
      api<RuntimeSettings>(path, { telemetryEnabled }),
    onSuccess: (settings) => {
      client.setQueryData(["telemetry-settings"], settings);
      // The default bot's own settings pages read the same record.
      void client.invalidateQueries({ queryKey: ["runtime-settings"] });
      void client.invalidateQueries({ queryKey: ["runtime-info"] });
    },
  });
  return { ...query, update };
}
