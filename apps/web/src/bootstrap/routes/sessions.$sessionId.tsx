import { createFileRoute } from "@tanstack/react-router";

import {
  isSection,
  type Section,
} from "../../domains/settings/presentation/settings";
import { Workspace } from "../../presentation/workspace/workspace";

export const Route = createFileRoute("/sessions/$sessionId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view?: "settings" | "notifications";
    section?: Section;
    bot?: string;
  } => ({
    bot:
      typeof search.bot === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(search.bot)
        ? search.bot
        : undefined,
    // Diagnostics moved into Settings → Diagnostics.
    view:
      search.view === "notifications"
        ? "notifications"
        : search.view === "diagnostics" || search.view === "settings"
          ? "settings"
          : undefined,
    section:
      search.view === "diagnostics"
        ? "telemetry"
        : isSection(search.section)
          ? search.section
          : undefined,
  }),
  component: SessionPage,
});

function SessionPage() {
  return (
    <Workspace sessionId={Route.useParams().sessionId} {...Route.useSearch()} />
  );
}
