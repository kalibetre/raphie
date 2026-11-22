import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Sparkles, UserRound } from "lucide-react";
import { useEffect } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { useBots } from "../../settings/infrastructure/use-bots";
import { useOwner } from "../../settings/infrastructure/use-owner";
import {
  useSkillChange,
  useSkills,
} from "../../settings/infrastructure/use-skills";
import type { Section } from "../../settings/presentation/settings-sections";
import type { ToolStep } from "../application/run-projection";
import {
  ownerSaved,
  personalityEdit,
  type SelfUpdateNote,
  selfUpdateNotes,
} from "../application/self-updates";

/**
 * What the bot changed about itself or the owner in this reply, with a way
 * to see or undo it. A change that did not save shows nothing.
 */
export function SelfUpdateNotes({ steps }: { steps: ToolStep[] }) {
  const notes = selfUpdateNotes(steps);
  if (!notes.length) return null;
  return (
    <div className="self-update-notes">
      {notes.map((note) => {
        // A provider may reuse call ids; the start tells them apart.
        const key = `${note.id}@${note.startedAt}`;
        return note.kind === "personality" ? (
          <PersonalityNote key={key} note={note} />
        ) : note.kind === "skill" ? (
          <SkillNote key={key} note={note} />
        ) : (
          <OwnerNote key={key} note={note} />
        );
      })}
    </div>
  );
}

function useOpenSettings() {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  return (section: Section, skill?: string) =>
    void navigate({
      to: "/",
      search: {
        bot: workspace.botId === "default" ? undefined : workspace.botId,
        view: "settings",
        section,
        skill,
      },
    });
}

function PersonalityNote({ note }: { note: SelfUpdateNote }) {
  const { workspace } = useBackend();
  const bots = useBots();
  const open = useOpenSettings();
  const profile = bots.data?.items.find((bot) => bot.id === workspace.botId);
  const history = useQuery({
    queryKey: ["bot-history", workspace.botId],
    queryFn: () =>
      workspace.api<{ items: BotProfile[] }>(
        `/api/bots/${workspace.botId}/history`,
      ),
    retry: false,
  });
  const found = history.data && personalityEdit(history.data.items, note);
  if (!profile || !found) return null;
  const current = profile.revision === found.edit.revision;
  const before = found.before;
  return (
    <p className="self-update-note">
      <Sparkles size={13} aria-hidden="true" />
      <span>Updated its personality</span>
      <button type="button" onClick={() => open("bot-history")}>
        See change
      </button>
      {current && before && (
        <button
          type="button"
          disabled={bots.save.isPending}
          onClick={() =>
            bots.save.mutate({
              name: profile.name,
              description: profile.description,
              color: profile.color ?? null,
              personality: before.personality,
              revision: profile.revision,
            })
          }
        >
          Undo
        </button>
      )}
    </p>
  );
}

function OwnerNote({ note }: { note: SelfUpdateNote }) {
  const owner = useOwner();
  const open = useOpenSettings();
  if (!owner.data || !ownerSaved(owner.data, note)) return null;
  return (
    <p className="self-update-note">
      <UserRound size={13} aria-hidden="true" />
      <span>Updated what it knows about you</span>
      <button type="button" onClick={() => open("owner")}>
        Review
      </button>
    </p>
  );
}

/**
 * A skill the bot wrote or improved with save_skill, found by the call that
 * saved it. Nothing shows when the save failed or the owner has since saved
 * the skill themselves.
 */
function SkillNote({ note }: { note: SelfUpdateNote }) {
  const list = useSkills().list;
  const { change, undo } = useSkillChange({
    id: note.id,
    from: note.startedAt,
    to: note.doneAt,
    version: JSON.stringify(
      list.data?.items.map((item) => [item.name, item.botChange]) ?? null,
    ),
  });
  const open = useOpenSettings();
  const found = change.data;
  const current = list.data?.items.find((item) => item.name === found?.name);
  // A change the skills list has not seen yet: refresh it, so this skill's
  // earlier notes learn they can no longer be undone.
  const unseen =
    !!found?.undoable &&
    (current?.botChange?.at !== found.at ||
      current.botChange.kind !== found.kind);
  const { refetch } = list;
  useEffect(() => {
    if (unseen) void refetch();
  }, [unseen, refetch]);
  if (!found) return null;
  const label = found.undone
    ? found.kind === "created"
      ? "Removed skill"
      : "Undid change to"
    : found.kind === "created"
      ? "New skill"
      : "Updated skill";
  return (
    <p className="self-update-note">
      <BookOpen size={13} aria-hidden="true" />
      <span>{label}</span>
      <code className="self-update-skill">{found.name}</code>
      {!(found.undone && found.kind === "created") && (
        <button type="button" onClick={() => open("skills", found.name)}>
          Open
        </button>
      )}
      {found.undoable && (
        <button
          type="button"
          disabled={undo.isPending}
          onClick={() => undo.mutate(found.id)}
        >
          Undo
        </button>
      )}
    </p>
  );
}
