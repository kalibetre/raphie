import type { BotProfile } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { botColors } from "../application/bot-tone";
import { useBots } from "../infrastructure/use-bots";
import { BotProfileFields } from "./bot-profile-fields";
import { SaveBar } from "./save-bar";
import { useSettingsGuard } from "./use-settings-guard";
const starterSoul =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

export function BotForm({
  profile,
  mode,
}: {
  profile?: BotProfile;
  mode: "profile" | "create";
}) {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  const bots = useBots();
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [color, setColor] = useState<string | null>(profile?.color ?? null);
  const [soul, setSoul] = useState(profile?.soul ?? starterSoul);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = bots.save.isPending || bots.create.isPending;
  const dirty = saved
    ? name !== saved.name ||
      description !== saved.description ||
      soul !== saved.soul ||
      color !== (saved.color ?? null)
    : !!name || !!description || soul !== starterSoul || color !== null;
  const guard = useSettingsGuard(dirty, pending);
  const changedElsewhere =
    !!profile && !!saved && profile.revision !== saved.revision;
  useEffect(() => {
    if (
      !profile ||
      !saved ||
      profile.revision === saved.revision ||
      dirty ||
      pending
    )
      return;
    setSaved(profile);
    setName(profile.name);
    setDescription(profile.description);
    setSoul(profile.soul);
    setColor(profile.color ?? null);
    setError("");
  }, [profile, saved, dirty, pending]);

  function discard() {
    const latest = profile ?? saved;
    setSaved(latest);
    setName(latest?.name ?? "");
    setDescription(latest?.description ?? "");
    setSoul(latest?.soul ?? starterSoul);
    setColor(latest?.color ?? null);
    setError("");
    setMessage("");
  }

  async function save() {
    setError("");
    setMessage("");
    const input = {
      name: name.trim(),
      description: description.trim(),
      soul: soul.trim(),
      color,
    };
    try {
      if (saved) {
        const updated = await bots.save.mutateAsync({
          ...input,
          revision: saved.revision,
        });
        setSaved(updated);
        setName(updated.name);
        setDescription(updated.description);
        setSoul(updated.soul);
        setColor(updated.color ?? null);
        setMessage(`Saved revision ${updated.revision}.`);
      } else {
        const created = await bots.create.mutateAsync(input);
        workspace.assertActive();
        guard.allowNavigation();
        await navigate({
          to: "/",
          search: { bot: created.id, view: "settings", section: "providers" },
        });
      }
    } catch (cause) {
      void bots.refetch();
      setError(
        cause instanceof Error ? cause.message : "Could not save this bot.",
      );
    }
  }

  return (
    <form
      className="bot-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <BotProfileFields
        botId={profile?.id ?? "new-bot"}
        color={color}
        automatic={botColors([
          ...(bots.data?.items ?? []).map((bot) =>
            bot.id === profile?.id ? { ...bot, color: null } : bot,
          ),
          ...(!profile ? [{ id: "new-bot" }] : []),
        ]).get(profile?.id ?? "new-bot")!}
        onColor={setColor}
        name={name}
        description={description}
        soul={soul}
        saved={saved}
        pending={pending}
        onName={setName}
        onDescription={setDescription}
        onSoul={setSoul}
      />
      {saved && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() =>
            void navigate({
              to: "/",
              search: {
                bot:
                  workspace.botId === "default" ? undefined : workspace.botId,
                view: "settings",
                section: "bot-history",
              },
            })
          }
        >
          View revision history ↗
        </Button>
      )}
      {mode === "create" && (
        <p className="bot-note">
          New bots start with their own memory and an empty workspace. Add a
          provider connection after creation.
        </p>
      )}
      <SaveBar
        visible={
          !saved || dirty || pending || !!message || !!error || !!guard.message
        }
        status={
          guard.message ||
          message ||
          (dirty
            ? "Unsaved changes"
            : saved
              ? `Revision ${saved.revision} · Saved to this bot.`
              : "Independent configuration. No settings are copied.")
        }
        error={
          changedElsewhere && dirty
            ? "This bot changed elsewhere. Your draft is preserved. Copy any edits you want to keep, then Discard to load the latest revision."
            : error
        }
        pending={pending}
        canSave={
          !changedElsewhere &&
          !!name.trim() &&
          !!soul.trim() &&
          (!saved || dirty)
        }
        canDiscard={dirty}
        label={saved ? "Save changes" : "Create bot"}
        onDiscard={discard}
      />
    </form>
  );
}
