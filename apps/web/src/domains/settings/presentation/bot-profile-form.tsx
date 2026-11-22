import type { BotProfile, ReplyStyle, SelfUpdates } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { botColors } from "../application/bot-tone";
import { useBots } from "../infrastructure/use-bots";
import { BotProfileFields } from "./bot-profile-fields";
import { DeleteBot } from "./delete-bot";
import { defaultReplyStyle, ReplyStyleFields } from "./reply-style-fields";
import { SaveBar } from "./save-bar";
import { SelfUpdateFields } from "./self-update-fields";
import { useSettingsGuard } from "./use-settings-guard";

const sameStyle = (a: ReplyStyle, b: ReplyStyle) =>
  a.length === b.length &&
  a.warmth === b.warmth &&
  a.formatting === b.formatting &&
  a.emoji === b.emoji;

/** A new bot may change its personality and skills, not the owner's profile. */
const newBotSelfUpdates: SelfUpdates = {
  personality: true,
  owner: false,
  skills: true,
};

const sameSelfUpdates = (a: SelfUpdates, b: SelfUpdates) =>
  a.personality === b.personality &&
  a.owner === b.owner &&
  a.skills === b.skills;

const starterPersonality =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

export function BotForm({ profile }: { profile: BotProfile }) {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  const bots = useBots();
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [color, setColor] = useState<string | null>(profile?.color ?? null);
  const [personality, setPersonality] = useState(
    profile?.personality ?? starterPersonality,
  );
  const [replyStyle, setReplyStyle] = useState<ReplyStyle>(
    profile?.replyStyle ?? defaultReplyStyle,
  );
  const [selfUpdates, setSelfUpdates] = useState<SelfUpdates>(
    profile?.selfUpdates ?? newBotSelfUpdates,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending =
    bots.save.isPending || bots.create.isPending || bots.remove.isPending;
  const dirty = saved
    ? name !== saved.name ||
      description !== saved.description ||
      personality !== saved.personality ||
      color !== (saved.color ?? null) ||
      !sameStyle(replyStyle, saved.replyStyle) ||
      !sameSelfUpdates(selfUpdates, saved.selfUpdates)
    : !!name ||
      !!description ||
      personality !== starterPersonality ||
      color !== null ||
      !sameStyle(replyStyle, defaultReplyStyle) ||
      !sameSelfUpdates(selfUpdates, newBotSelfUpdates);
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
    setPersonality(profile.personality);
    setColor(profile.color ?? null);
    setReplyStyle(profile.replyStyle);
    setSelfUpdates(profile.selfUpdates);
    setError("");
  }, [profile, saved, dirty, pending]);

  function discard() {
    const latest = profile ?? saved;
    setSaved(latest);
    setName(latest?.name ?? "");
    setDescription(latest?.description ?? "");
    setPersonality(latest?.personality ?? starterPersonality);
    setColor(latest?.color ?? null);
    setReplyStyle(latest?.replyStyle ?? defaultReplyStyle);
    setSelfUpdates(latest?.selfUpdates ?? newBotSelfUpdates);
    setError("");
    setMessage("");
  }

  async function save() {
    setError("");
    setMessage("");
    const input = {
      name: name.trim(),
      description: description.trim(),
      personality: personality.trim(),
      color,
      replyStyle,
      selfUpdates,
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
        setPersonality(updated.personality);
        setColor(updated.color ?? null);
        setReplyStyle(updated.replyStyle);
        setSelfUpdates(updated.selfUpdates);
        setMessage(`Saved revision ${updated.revision}.`);
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
        botId={profile.id}
        color={color}
        automatic={botColors(
          (bots.data?.items ?? []).map((bot) =>
            bot.id === profile.id ? { ...bot, color: null } : bot,
          ),
        ).get(profile.id)!}
        onColor={setColor}
        name={name}
        description={description}
        personality={personality}
        saved={saved}
        pending={pending}
        onName={setName}
        onDescription={setDescription}
        onPersonality={setPersonality}
      />
      <ReplyStyleFields
        style={replyStyle}
        pending={pending}
        onChange={setReplyStyle}
      />
      <SelfUpdateFields
        value={selfUpdates}
        pending={pending}
        onChange={setSelfUpdates}
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
      {saved && saved.id !== "default" && (
        <DeleteBot
          profile={saved}
          disabled={dirty || pending || changedElsewhere}
          pending={bots.remove.isPending}
          onDelete={async () => {
            await bots.remove.mutateAsync(saved);
            workspace.assertActive();
            guard.allowNavigation();
            await navigate({ to: "/", search: {} });
          }}
        />
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
          !!personality.trim() &&
          (!saved || dirty)
        }
        canDiscard={dirty}
        label="Save changes"
        onDiscard={discard}
      />
    </form>
  );
}
