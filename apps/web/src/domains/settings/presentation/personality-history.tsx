import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Group } from "./settings-group";
import { SettingsStatus } from "./settings-status";

/** Saved personality revisions as a timeline; open one to read its SOUL.md. */
export function PersonalityHistory({ profile }: { profile: BotProfile }) {
  const { workspace } = useBackend();
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
    <Group title="Revisions" note="The latest 50 saved versions.">
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
                  viewportLabel={`SOUL.md revision ${revision.revision}`}
                >
                  <pre>{revision.soul}</pre>
                </ScrollArea>
              </details>
            </li>
          );
        })}
      </ol>
    </Group>
  );
}
