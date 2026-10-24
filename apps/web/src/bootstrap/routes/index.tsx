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
    view?: "settings";
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
    // Older links used view=plugins and view=diagnostics before both moved
    // into Settings.
    view: ["diagnostics", "plugins", "settings"].includes(search.view as string)
      ? "settings"
      : undefined,
    section:
      search.view === "diagnostics"
        ? "telemetry"
        : search.view === "plugins"
          ? "plugins"
          : isSection(search.section)
            ? search.section
            : undefined,
  }),
  component: IndexPage,
});

function IndexPage() {
  const { conversation, ...search } = Route.useSearch();
  return <Workspace legacyConversationId={conversation} {...search} />;
}
