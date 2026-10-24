import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

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
