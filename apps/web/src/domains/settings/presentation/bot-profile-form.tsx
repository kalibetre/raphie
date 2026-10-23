import type { BotProfile } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar } from "./bot-avatar";
import { BotProfileFields } from "./bot-profile-fields";
import { useSettingsGuard } from "./use-settings-guard";
const starterSoul =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

export function BotForm({
  profile,
  mode,
}: {
  profile?: BotProfile;
  mode: "profile" | "personality" | "create";
}) {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  const bots = useBots();
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [soul, setSoul] = useState(profile?.soul ?? starterSoul);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = bots.save.isPending || bots.create.isPending;
  const dirty = saved
    ? name !== saved.name ||
      description !== saved.description ||
      soul !== saved.soul
    : !!name || !!description || soul !== starterSoul;
  const guard = useSettingsGuard(dirty, pending);

  function discard() {
    setName(saved?.name ?? "");
    setDescription(saved?.description ?? "");
    setSoul(saved?.soul ?? starterSoul);
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
        setMessage(
          `Saved revision ${updated.revision}. New turns use this personality.`,
        );
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
      {mode === "profile" && saved && (
        <div className="bot-profile-identity">
          <BotAvatar id={saved.id} />
          <div>
            <strong>{saved.name}</strong>
            <small>
              {saved.id === "default" ? "Default bot" : "Independent bot"} ·
              Revision {saved.revision}
            </small>
          </div>
        </div>
      )}
      <div className="bot-editor-section">
        <h2>
          {mode === "personality"
            ? `How ${name} works with you`
            : mode === "create"
              ? "A separate assistant"
              : "Identity"}
        </h2>
        <p>
          {mode === "personality"
            ? `Tone, values and working style, shared across ${name}’s conversations.`
            : "How this bot appears in your sidebar and conversations."}
        </p>
        <BotProfileFields
          mode={mode}
          name={name}
          description={description}
          soul={soul}
          saved={saved}
          pending={pending}
          onName={setName}
          onDescription={setDescription}
          onSoul={setSoul}
        />
        {mode === "personality" && (
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
      </div>
      {mode === "profile" && saved && (
        <div className="bot-editor-section">
          <h2>This bot’s setup</h2>
          <div className="bot-setup-row">
            <span>Personality</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() =>
                void navigate({
                  to: "/",
                  search: {
                    bot:
                      workspace.botId === "default"
                        ? undefined
                        : workspace.botId,
                    view: "settings",
                    section: "personality",
                  },
                })
              }
            >
              Revision {saved.revision} ↗
            </Button>
          </div>
          <div className="bot-setup-row">
            <span>Bot ID</span>
            <code>{saved.id}</code>
          </div>
        </div>
      )}
      <div className="bot-save-bar">
        <div>
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          <p role="status">
            {guard.message ||
              message ||
              (dirty
                ? "Unsaved changes"
                : saved
                  ? `Revision ${saved.revision} · Saved to this bot.`
                  : "Independent configuration. No settings are copied.")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || !dirty}
          onClick={discard}
        >
          Discard
        </Button>
        <Button
          type="submit"
          disabled={
            pending || !name.trim() || !soul.trim() || (!!saved && !dirty)
          }
        >
          {pending ? "Saving…" : saved ? "Save changes" : "Create bot"}
        </Button>
      </div>
    </form>
  );
}
