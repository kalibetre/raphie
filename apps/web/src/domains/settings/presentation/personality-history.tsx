import type { BotProfile } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Group } from "./settings-group";

export function PersonalityHistory({ profile }: { profile: BotProfile }) {
  const { workspace } = useBackend();
  const history = useQuery({
    queryKey: ["bot-history", profile.id],
    queryFn: () =>
      workspace.api<{ items: BotProfile[] }>(`/api/bots/${profile.id}/history`),
    retry: false,
  });
  return (
    <Group
      title="Personality revisions"
      note={`Saved versions of ${profile.name}’s personality. The latest 50 revisions appear here.`}
    >
      <div className="settings-form">
        {history.isPending && <p role="status">Loading revisions…</p>}
        {history.error && (
          <Button variant="outline" onClick={() => void history.refetch()}>
            Couldn’t load revisions. Retry
          </Button>
        )}
        {history.data?.items.map((revision) => (
          <details key={revision.revision}>
            <summary>
              Revision {revision.revision} ·{" "}
              {new Date(revision.updatedAt).toLocaleString()}
              {revision.revision === profile.revision ? " · Current" : ""}
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
  );
}
