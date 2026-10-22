import { createFileRoute } from "@tanstack/react-router";

import type { Section } from "../../domains/settings/presentation/settings";
import { Workspace } from "../../presentation/workspace/workspace";

export const Route = createFileRoute("/sessions/$sessionId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "diagnostics" | "settings"; section?: Section } => ({
    view:
      search.view === "diagnostics" || search.view === "settings"
        ? search.view
        : undefined,
    section:
      search.section === "models" ||
      search.section === "providers" ||
      search.section === "telemetry" ||
      search.section === "connection" ||
      search.section === "general" ||
      search.section === "plugins"
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
