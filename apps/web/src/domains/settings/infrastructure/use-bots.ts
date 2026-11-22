import type {
  BotProfile,
  PersonalityPreset,
  SaveBotProfile,
  UpdateBotProfile,
} from "@raphie/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useBots() {
  const { workspace, backend } = useBackend();
  // The bot list is backend-wide, so it survives bot changes without a refetch.
  const client = backend.queries;
  const query = useQuery(
    {
      queryKey: ["bots"],
      queryFn: () => backend.api<{ items: BotProfile[] }>("/api/bots"),
      retry: false,
      refetchInterval: 30000,
    },
    client,
  );
  const save = useMutation({
    mutationFn: (input: UpdateBotProfile) =>
      workspace.api<BotProfile>(`/api/bots/${workspace.botId}/profile`, input),
    onSuccess: (profile) => {
      client.setQueryData<{ items: BotProfile[] }>(["bots"], (current) => ({
        items: current?.items.map((bot) =>
          bot.id === profile.id ? profile : bot,
        ) ?? [profile],
      }));
      void workspace.queries.invalidateQueries({
        queryKey: ["bot-history", profile.id],
      });
    },
  });
  const create = useMutation({
    mutationFn: (input: SaveBotProfile) =>
      workspace.api<BotProfile>("/api/bots", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["bots"] });
    },
  });
  const remove = useMutation({
    mutationFn: (profile: BotProfile) =>
      workspace.api<void>(
        `/api/bots/${encodeURIComponent(profile.id)}`,
        { name: profile.name, revision: profile.revision },
        "DELETE",
      ),
    onSuccess: (_, profile) => {
      workspace.clearBotDrafts();
      client.setQueryData<{ items: BotProfile[] }>(["bots"], (current) => ({
        items: current?.items.filter((bot) => bot.id !== profile.id) ?? [],
      }));
      client.removeQueries({ queryKey: ["bot-inbox", profile.id] });
    },
  });
  return { ...query, save, create, remove };
}

/** The built-in personalities a bot can start from; the same for every bot. */
export function usePersonalityPresets() {
  const { backend } = useBackend();
  return useQuery(
    {
      queryKey: ["personality-presets"],
      queryFn: () =>
        backend.api<{ items: PersonalityPreset[] }>("/api/bots/personalities"),
      retry: false,
      staleTime: Infinity,
    },
    backend.queries,
  );
}
