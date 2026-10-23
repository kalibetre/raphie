import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Textarea } from "../../../shared/ui/textarea";
import { useBots } from "../infrastructure/use-bots";
import { Group } from "./settings-group";

const starterSoul =
  "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

export function BotSettings() {
  const { workspace, selectBot } = useBackend();
  const bots = useBots();
  const [creating, setCreating] = useState(false);
  const profile = bots.data?.items.find((bot) => bot.id === workspace.botId);
  if (bots.data && !profile)
    return (
      <Group title="Bot not found">
        <div className="settings-form">
          <p>This bot does not exist on the selected backend.</p>
          <Button variant="outline" onClick={() => void selectBot("default")}>
            Open default bot
          </Button>
        </div>
      </Group>
    );
  if (!profile)
    return (
      <Group title="Bot">
        <div className="settings-form">
          <p role="status">
            {bots.error
              ? "Bot settings are unavailable. This backend may need an update."
              : "Loading bot settings…"}
          </p>
          <Button variant="outline" onClick={() => void bots.refetch()}>
            Retry
          </Button>
        </div>
      </Group>
    );
  return (
    <>
      <header className="catalog-heading bot-heading">
        <div>
          <h2>{creating ? "Create a bot" : profile.name}</h2>
          <p>
            Each bot has its own sessions, model connections, memory and
            personality.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCreating(!creating)}>
          {creating ? "Back to current bot" : "New bot"}
        </Button>
      </header>
      <BotForm
        key={creating ? "create" : profile.id}
        profile={creating ? undefined : profile}
        onCreated={() => setCreating(false)}
      />
    </>
  );
}

function BotForm({
  profile,
  onCreated,
}: {
  profile?: BotProfile;
  onCreated: () => void;
}) {
  const { workspace, selectBot } = useBackend();
  const bots = useBots();
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [soul, setSoul] = useState(profile?.soul ?? starterSoul);
  const [saved, setSaved] = useState(profile);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const history = useQuery({
    queryKey: ["bot-history", profile?.id],
    enabled: !!profile,
    queryFn: () =>
      workspace.api<{ items: BotProfile[] }>(
        `/api/bots/${profile!.id}/history`,
      ),
    retry: false,
  });
  const pending = bots.save.isPending || bots.create.isPending;
  const dirty =
    !saved ||
    name !== saved.name ||
    description !== saved.description ||
    soul !== saved.soul;
  return (
    <>
      <Group
        title={profile ? "Identity and personality" : "A separate assistant"}
        note="SOUL.md shapes tone, values and interaction style. It does not grant tools or access to another bot's data."
      >
        <form
          className="settings-form bot-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setMessage("");
            const input = {
              name: name.trim(),
              description: description.trim(),
              soul: soul.trim(),
            };
            void (async () => {
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
                    `Saved revision ${updated.revision}. New turns will use this personality.`,
                  );
                } else {
                  const created = await bots.create.mutateAsync(input);
                  await selectBot(created.id);
                  onCreated();
                }
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not save this bot.",
                );
              }
            })();
          }}
        >
          <label htmlFor="bot-name">Name</label>
          <Input
            id="bot-name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            placeholder="Research assistant"
          />
          <label htmlFor="bot-description">Description</label>
          <Input
            id="bot-description"
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
            placeholder="What this bot helps you with"
          />
          <label htmlFor="bot-soul">SOUL.md</label>
          <Textarea
            id="bot-soul"
            className="bot-soul min-h-56"
            required
            maxLength={16000}
            value={soul}
            onChange={(event) => setSoul(event.target.value)}
            disabled={pending}
            aria-describedby="bot-soul-note"
          />
          <p id="bot-soul-note">
            Owner-managed and revisioned. Bots receive their own personality in
            the model instructions; they cannot edit it through memory tools. To
            undo an edit, copy an earlier revision and save it again.
          </p>
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="settings-actions">
            <Button
              type="submit"
              disabled={pending || !dirty || !name.trim() || !soul.trim()}
            >
              {pending ? "Saving…" : saved ? "Save bot" : "Create bot"}
            </Button>
            {saved && (
              <span className="bot-picker-label">
                Revision {saved.revision}
                {saved.id === "default" ? " · default bot" : ""}
              </span>
            )}
          </div>
        </form>
      </Group>
      {!profile && (
        <p className="bot-note">
          New bots start with built-in memory and an empty workspace. After
          creation, add a provider in Providers and choose a model. Credentials
          and connected tools are not copied from your current bot.
        </p>
      )}
      {profile && (
        <Group
          title="Personality history"
          note="The latest 50 saved revisions. History contains no model credentials."
        >
          <div className="settings-form">
            {history.error && <p role="alert">Could not load revisions.</p>}
            {history.data?.items.map((revision) => (
              <details key={revision.revision}>
                <summary>
                  Revision {revision.revision} ·{" "}
                  {new Date(revision.updatedAt).toLocaleString()}
                </summary>
                <p>
                  {revision.name} · {revision.description}
                </p>
                <ScrollArea
                  className="bot-history"
                  viewportLabel={`SOUL.md revision ${revision.revision}`}
                >
                  <pre>{revision.soul}</pre>
                </ScrollArea>
              </details>
            ))}
          </div>
        </Group>
      )}
    </>
  );
}
