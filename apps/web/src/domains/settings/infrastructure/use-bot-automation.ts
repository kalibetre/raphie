import type { BotMcpConnection } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";

/**
 * The owner's name for each of the bot's saved connections, by id. It shares
 * Settings' cache but does not poll: names rarely change mid-chat.
 */
export function useConnectionNames() {
  const { workspace } = useBackend();
  const { data } = useQuery({
    queryKey: ["bot-automation", "mcp"],
    queryFn: () => workspace.api<{ items: BotMcpConnection[] }>("/api/mcp"),
    staleTime: 60_000,
  });
  return useMemo(
    () => new Map(data?.items.map((c) => [c.id, c.name]) ?? []),
    [data],
  );
}

/** BotBoundary owns this cache and retires writes when the bot changes. */
export function useBotAutomation<T>(resource: "mcp" | "jobs") {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const key = ["bot-automation", resource];
  const query = useQuery({
    queryKey: key,
    queryFn: () => workspace.api<{ items: T[] }>(`/api/${resource}`),
    refetchInterval: 5000,
  });
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: unknown }) =>
      workspace.api<{ items: T[] }>(
        `/api/${resource}${id ? `/${id}` : ""}`,
        input,
      ),
    onSuccess: (data) => {
      client.setQueryData(key, data);
    },
  });
  return { ...query, mutation };
}
