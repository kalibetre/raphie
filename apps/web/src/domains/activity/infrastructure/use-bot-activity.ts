import type { Page } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import type { ActivityEvent } from "../../../infrastructure/http/api-client";
import { useBackend } from "../../../infrastructure/http/backend-context";

/** The selected bot's recent activity across all of its conversations. */
export function useBotActivity() {
  const { workspace } = useBackend();
  return useQuery({
    queryKey: ["bot-activity"],
    queryFn: () =>
      workspace.api<Page<ActivityEvent>>("/api/inspection/activity?limit=100"),
    refetchInterval: 5000,
  });
}
