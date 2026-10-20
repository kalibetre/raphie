import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "../components/workspace";
export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { conversation?: number; view?: "diagnostics" | "plugins" } => ({
    conversation:
      Number.isSafeInteger(Number(search.conversation)) &&
      Number(search.conversation) > 0
        ? Number(search.conversation)
        : undefined,
    view:
      search.view === "diagnostics" || search.view === "plugins"
        ? search.view
        : undefined,
  }),
  component: Workspace,
});
