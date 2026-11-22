import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, UserRound } from "lucide-react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { useBots } from "../../settings/infrastructure/use-bots";
import { useOwner } from "../../settings/infrastructure/use-owner";
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
      {notes.map((note) =>
        note.kind === "personality" ? (
          <PersonalityNote key={note.id} note={note} />
        ) : (
          <OwnerNote key={note.id} note={note} />
        ),
      )}
    </div>
  );
}

function useOpenSettings() {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  return (section: Section) =>
    void navigate({
      to: "/",
      search: {
        bot: workspace.botId === "default" ? undefined : workspace.botId,
        view: "settings",
        section,
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
