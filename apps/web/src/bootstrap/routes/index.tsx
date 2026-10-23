import { createFileRoute } from "@tanstack/react-router";

import {
  isSection,
  type Section,
} from "../../domains/settings/presentation/settings";
import { Workspace } from "../../presentation/workspace/workspace";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    conversation?: number;
    view?: "diagnostics" | "settings";
    section?: Section;
    bot?: string;
  } => ({
    bot:
      typeof search.bot === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(search.bot)
        ? search.bot
        : undefined,
    conversation:
      Number.isSafeInteger(Number(search.conversation)) &&
      Number(search.conversation) > 0
        ? Number(search.conversation)
        : undefined,
    // Older links used view=plugins before Plugins moved into Settings.
    view:
      search.view === "diagnostics" || search.view === "settings"
        ? search.view
        : search.view === "plugins"
          ? "settings"
          : undefined,
    section: isSection(search.section)
      ? search.section
      : search.view === "plugins"
        ? "plugins"
        : undefined,
  }),
  component: IndexPage,
});

function IndexPage() {
  const { conversation, ...search } = Route.useSearch();
  return <Workspace legacyConversationId={conversation} {...search} />;
}
