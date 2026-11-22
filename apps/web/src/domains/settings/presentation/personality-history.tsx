import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { useBots, usePersonalityPresets } from "../infrastructure/use-bots";
import { Group } from "./settings-group";
import { SettingsStatus } from "./settings-status";

/**
 * Saved personality revisions as a timeline; open one to read it, or
 * restore its personality as a new revision.
 */
export function PersonalityHistory({ profile }: { profile: BotProfile }) {
  const { workspace } = useBackend();
  const bots = useBots();
  const presets = usePersonalityPresets().data?.items ?? [];
  const restore = (revision: BotProfile) =>
    bots.save.mutate({
      name: profile.name,
      description: profile.description,
      color: profile.color ?? null,
      personality: revision.personality,
      revision: profile.revision,
    });
  const history = useQuery({
    queryKey: ["bot-history", profile.id],
    queryFn: () =>
      workspace.api<{ items: BotProfile[] }>(`/api/bots/${profile.id}/history`),
    retry: false,
  });
  if (!history.data)
    return (
      <SettingsStatus
        title="Revisions"
        message={
          history.error ? "Couldn’t load revisions." : "Loading revisions…"
        }
        onRetry={history.error ? () => void history.refetch() : undefined}
      />
    );
  return (
    <Group
      title="Revisions"
      note="The latest 50 saved versions. Restoring one saves it as a new revision."
    >
      {bots.save.error instanceof Error && (
        <p role="alert" className="settings-error">
          {bots.save.error.message}
        </p>
      )}
      <ol className="revision-timeline">
        {history.data.items.map((revision) => {
          const current = revision.revision === profile.revision;
          return (
            <li key={revision.revision} data-current={current}>
              <details open={current}>
                <summary>
                  <span className="revision-dot" aria-hidden="true" />
                  <strong>Revision {revision.revision}</strong>
                  {current && <span className="revision-current">Current</span>}
                  {revision.changedBy === "bot" && (
                    <span className="revision-tag">by {revision.name}</span>
                  )}
                  {revision.preset && (
                    <span className="revision-tag revision-tag-preset">
                      {presets.find((p) => p.id === revision.preset)?.name ??
                        revision.preset}
                    </span>
                  )}
                  <time dateTime={new Date(revision.updatedAt).toISOString()}>
                    {new Date(revision.updatedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </summary>
                <p className="revision-meta">
                  {revision.name}
                  {revision.description && ` · ${revision.description}`}
                  {` · Color: ${revision.color ?? "Automatic"}`}
                </p>
                <ScrollArea
                  className="bot-history"
                  viewportLabel={`Personality revision ${revision.revision}`}
                >
                  <pre>{revision.personality}</pre>
                </ScrollArea>
                {revision.personality !== profile.personality && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="revision-restore"
                    disabled={bots.save.isPending}
                    onClick={() => restore(revision)}
                  >
                    Restore this personality
                  </Button>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </Group>
  );
}
