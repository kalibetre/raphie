import type { ReactNode } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { useBots } from "../infrastructure/use-bots";
import { AppearanceSettings } from "./appearance-settings";
import { BotSettings } from "./bot-settings";
import { ChannelSettings } from "./channel-settings";
import { ConnectionSettings } from "./connection-settings";
import { DeviceSettings } from "./device-settings";
import { JobSettings } from "./job-settings";
import { McpSettings } from "./mcp-settings";
import { MemoryBrowse } from "./memory-browse";
import { MemorySettings } from "./memory-settings";
import { ModelSettings } from "./model-settings";
import { PluginSettings } from "./plugin-settings";
import { ProviderSettings } from "./provider-settings";
import { SandboxSettings } from "./sandbox-settings";
import { SettingsPage } from "./settings-page";
import {
  isAppSection,
  parentSection,
  type Section,
  sectionOf,
} from "./settings-sections";
import { TelemetrySettings } from "./telemetry-settings";
import { WorkspaceFiles } from "./workspace-files";

export {
  isAppSection,
  isSection,
  type Section,
  sections,
} from "./settings-sections";

/** Renders one settings page inside the shared page frame. */
export function Settings({
  section,
  enabled,
  setEnabled,
  traces,
  activity,
  onParent,
}: {
  section: Section;
  enabled: string[];
  setEnabled: (ids: string[]) => void;
  /** Trace list shown under Diagnostics; composed by the workspace. */
  traces: ReactNode;
  /** Bot-wide activity journal; composed by the workspace. */
  activity: ReactNode;
  /** Opens the page a sub-page was reached from. */
  onParent: (section: Section) => void;
}) {
  const { workspace } = useBackend();
  const profile = useBots().data?.items.find((b) => b.id === workspace.botId);
  const page = sectionOf(section === "personality" ? "bot" : section);
  const name = profile?.name ?? "this bot";
  const scoped = !isAppSection(section) && section !== "new-bot";
  const parent = parentSection[section];
  return (
    <ScrollArea className="settings-scroll" viewportLabel="Settings">
      <SettingsPage
        title={page.label}
        lede={page.lede(name)}
        bot={scoped ? { id: workspace.botId, name } : undefined}
        scope={section === "new-bot" ? "New bot" : "App-wide"}
        back={
          parent
            ? {
                label: sectionOf(parent).label,
                onClick: () => onParent(parent),
              }
            : undefined
        }
      >
        {section === "bot" || section === "personality" ? (
          <BotSettings />
        ) : section === "bot-history" ? (
          <BotSettings mode="history" />
        ) : section === "new-bot" ? (
          <BotSettings mode="create" />
        ) : section === "providers" ? (
          <ProviderSettings />
        ) : section === "models" ? (
          <ModelSettings />
        ) : section === "mcp" ? (
          <McpSettings />
        ) : section === "channels" ? (
          <ChannelSettings />
        ) : section === "sandbox" ? (
          <SandboxSettings onBrowse={() => onParent("workspace")} />
        ) : section === "workspace" ? (
          <WorkspaceFiles onSandbox={() => onParent("sandbox")} />
        ) : section === "jobs" ? (
          <JobSettings />
        ) : section === "memory" ? (
          <MemorySettings />
        ) : section === "memory-browse" ? (
          <MemoryBrowse />
        ) : section === "telemetry" ? (
          <TelemetrySettings traces={traces} />
        ) : section === "activity" ? (
          activity
        ) : section === "connection" ? (
          <ConnectionSettings />
        ) : section === "devices" ? (
          <DeviceSettings />
        ) : section === "general" ? (
          <AppearanceSettings />
        ) : (
          <PluginSettings enabled={enabled} setEnabled={setEnabled} />
        )}
      </SettingsPage>
    </ScrollArea>
  );
}
