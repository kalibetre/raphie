import type {
  SaveSkill,
  SkillDetail,
  SkillImport,
  SkillList,
} from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

const listKey = ["skills"];

/** This bot's skills. BotBoundary owns the cache and retires it on a switch. */
export function useSkills() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => workspace.api<SkillList>("/api/skills"),
    // The bot can write skills too; notice them without a reload.
    refetchInterval: 10_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: listKey });
  const enable = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      workspace.api<SkillList>(
        `/api/skills/${encodeURIComponent(name)}/enabled`,
        { enabled },
        "PUT",
      ),
    onSuccess: (data) => client.setQueryData(listKey, data),
  });
  const save = useMutation({
    mutationFn: ({
      name,
      input,
      create,
    }: {
      name: string;
      input: SaveSkill;
      create: boolean;
    }) =>
      workspace.api<SkillDetail>(
        `/api/skills/${encodeURIComponent(name)}`,
        input,
        create ? "POST" : "PUT",
      ),
    onSuccess: (detail) => {
      client.setQueryData(["skill", detail.name], detail);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (name: string) =>
      workspace.api<null>(
        `/api/skills/${encodeURIComponent(name)}`,
        {},
        "DELETE",
      ),
    onSuccess: () => refresh(),
  });
  const importSkills = useMutation({
    mutationFn: (
      source:
        { file: File; replace: boolean } | { url: string; replace: boolean },
    ) => {
      if ("url" in source)
        return workspace.api<SkillImport>("/api/skills/import/github", source);
      const form = new FormData();
      form.set("file", source.file);
      form.set("replace", String(source.replace));
      return workspace.api<SkillImport>("/api/skills/import", form);
    },
    onSuccess: () => refresh(),
  });
  return { list, enable, save, remove, importSkills };
}

/** One skill with its files, for the editor. */
export function useSkill(name: string | null) {
  const { workspace } = useBackend();
  return useQuery({
    queryKey: ["skill", name],
    queryFn: () =>
      workspace.api<SkillDetail>(`/api/skills/${encodeURIComponent(name!)}`),
    enabled: !!name,
    staleTime: Infinity,
  });
}
