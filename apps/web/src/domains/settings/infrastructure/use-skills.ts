import type {
  SaveSkill,
  SkillChange,
  SkillDetail,
  SkillImport,
  SkillList,
} from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../../infrastructure/http/api-client";
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

/**
 * The change save_skill call `call` made while it ran, from `from` to `to`
 * as its step saw it on the runtime's clock, and its undo. Null when it saved nothing, or once
 * the owner has saved the skill themselves.
 */
export function useSkillChange(call: {
  id: string;
  from: number;
  to: number;
  /**
   * Changes when the skill does, as the skills list sees it, so a note
   * stops offering an undo once a later change or the owner's edit lands.
   */
  version: string;
}) {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = new URLSearchParams({
    call: call.id,
    from: String(Math.floor(call.from)),
    to: String(Math.ceil(call.to)),
  });
  const change = useQuery({
    queryKey: ["skill-change", query.toString(), call.version],
    queryFn: async () => {
      try {
        return await workspace.api<SkillChange>(`/api/skills/changes?${query}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
    // Settings can make it the owner's, and a later reply can supersede it.
    staleTime: 10_000,
  });
  const undo = useMutation({
    mutationFn: (id: string) =>
      workspace.api<SkillList>(
        `/api/skills/changes/${encodeURIComponent(id)}/undo`,
        {},
      ),
    onSuccess: (list) => {
      client.setQueryData(listKey, list);
      void client.invalidateQueries({ queryKey: ["skill"] });
    },
    // Refused because the skill changed since: show it as it is now.
    onSettled: () => client.invalidateQueries({ queryKey: ["skill-change"] }),
  });
  return { change, undo };
}
