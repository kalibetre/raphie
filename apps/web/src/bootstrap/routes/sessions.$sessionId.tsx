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
    view?: "diagnostics" | "settings";
    section?: Section;
    bot?: string;
  } => ({
    bot:
      typeof search.bot === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(search.bot)
        ? search.bot
        : undefined,
    view:
      search.view === "diagnostics" || search.view === "settings"
        ? search.view
        : undefined,
    section: isSection(search.section) ? search.section : undefined,
  }),
  component: SessionPage,
});

function SessionPage() {
  return (
    <Workspace sessionId={Route.useParams().sessionId} {...Route.useSearch()} />
  );
}
