import type {
  BotProfile,
  SaveBotProfile,
  UpdateBotProfile,
} from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useBots() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["bots"],
    queryFn: () => workspace.api<{ items: BotProfile[] }>("/api/bots"),
    retry: false,
    refetchInterval: 30000,
  });
  const save = useMutation({
    mutationFn: (input: UpdateBotProfile) =>
      workspace.api<BotProfile>(`/api/bots/${workspace.botId}/profile`, input),
    onSuccess: (profile) => {
      client.setQueryData<{ items: BotProfile[] }>(["bots"], (current) => ({
        items: current?.items.map((bot) =>
          bot.id === profile.id ? profile : bot,
        ) ?? [profile],
      }));
      void client.invalidateQueries({ queryKey: ["bot-history", profile.id] });
    },
  });
  const create = useMutation({
    mutationFn: (input: SaveBotProfile) =>
      workspace.api<BotProfile>("/api/bots", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["bots"] });
    },
  });
  return { ...query, save, create };
}
