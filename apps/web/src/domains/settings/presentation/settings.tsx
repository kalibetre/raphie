import { type ReactNode, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { useBots } from "../infrastructure/use-bots";
import { AccountSettings } from "./account-settings";
import { AppearanceSettings } from "./appearance-settings";
import { BotSettings } from "./bot-settings";
import { ChannelSettings } from "./channel-settings";
import { JobSettings } from "./job-settings";
import { McpSettings } from "./mcp-settings";
import { MemoryBrowse } from "./memory-browse";
import { MemorySettings } from "./memory-settings";
import { ModelSettings } from "./model-settings";
import { OwnerSettings } from "./owner-settings";
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
import {
  skillHeader,
  type SkillLeave,
  SkillSettings,
  type SkillView,
} from "./skill-settings";
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
  skill: openSkill,
  enabled,
  setEnabled,
  traces,
  activity,
  onParent,
}: {
  section: Section;
  /** A skill to open under Skills, as a reply's note links to it. */
  skill?: string;
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
  const scoped = !isAppSection(section);
  const parent = parentSection[section];
  // An open skill is a sub-page of Skills, kept here so the page header can
  // name it and link back. It starts on the list whenever Skills opens.
  const [skills, setSkills] = useState<{ section: Section; view: SkillView }>({
    section,
    view: openSkill ? { mode: "edit", name: openSkill } : { mode: "list" },
  });
  // A link to a skill opens it, even when Settings is already showing.
  const [linked, setLinked] = useState(openSkill);
  if (openSkill !== linked) {
    setLinked(openSkill);
    if (openSkill)
      setSkills({ section, view: { mode: "edit", name: openSkill } });
  }
  const skillView: SkillView =
    skills.section === section ? skills.view : { mode: "list" };
  const setSkillView = (view: SkillView) => setSkills({ section, view });
  const leaveSkillRef = useRef<SkillLeave["current"]>(null);
  const skill = section === "skills" ? skillHeader(skillView) : null;
  return (
    <ScrollArea className="settings-scroll" viewportLabel="Settings">
      <SettingsPage
        title={skill?.title ?? page.label}
        lede={skill?.lede ?? page.lede(name)}
        bot={scoped ? { id: workspace.botId, name } : undefined}
        scope="App-wide"
        back={
          skill
            ? {
                label: page.label,
                onClick: () => {
                  if (leaveSkillRef.current?.() !== false)
                    setSkillView({ mode: "list" });
                },
              }
            : parent
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
        ) : section === "providers" ? (
          <ProviderSettings />
        ) : section === "models" ? (
          <ModelSettings />
        ) : section === "mcp" ? (
          <McpSettings />
        ) : section === "skills" ? (
          <SkillSettings
            view={skillView}
            onView={setSkillView}
            leaveRef={leaveSkillRef}
          />
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
        ) : section === "owner" ? (
          <OwnerSettings />
        ) : section === "account" ? (
          <AccountSettings />
        ) : section === "general" ? (
          <AppearanceSettings />
        ) : (
          <PluginSettings enabled={enabled} setEnabled={setEnabled} />
        )}
      </SettingsPage>
    </ScrollArea>
  );
}
