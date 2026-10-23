import {
  BookOpen,
  Bot,
  Brain,
  KeyRound,
  Library,
  Monitor,
  Moon,
  Puzzle,
  Radio,
  Server,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Switch } from "../../../shared/ui/switch";
import { plugins } from "../infrastructure/plugins/index";
import { applyTheme, type Theme } from "../infrastructure/theme";
import { useBots } from "../infrastructure/use-bots";
import { BotSettings } from "./bot-settings";
import { ConnectionSettings } from "./connection-settings";
import { MemoryBrowse, MemorySettings } from "./memory-settings";
import { ModelSettings } from "./model-settings";
import { ProviderSettings } from "./provider-settings";
import { Group, Row } from "./settings-group";
import { TelemetrySettings } from "./telemetry-settings";

export const sections = [
  { id: "bot", label: "Profile", icon: Bot },
  { id: "personality", label: "Personality", icon: Bot },
  { id: "bot-history", label: "Revision history", icon: Bot },
  { id: "new-bot", label: "Create a bot", icon: Bot },
  { id: "connection", label: "Backend connection", icon: Server },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "models", label: "Models", icon: Brain },
  { id: "memory", label: "Memory", icon: BookOpen },
  { id: "memory-browse", label: "Browse memory", icon: Library },
  { id: "plugins", label: "UI plugins", icon: Puzzle },
  { id: "general", label: "Appearance", icon: SlidersHorizontal },
  { id: "telemetry", label: "Diagnostics", icon: Radio },
] as const;

export const isAppSection = (section: string) =>
  ["connection", "general", "plugins"].includes(section);

export type Section = (typeof sections)[number]["id"];

export const isSection = (value: unknown): value is Section =>
  sections.some((section) => section.id === value);

export function Settings({
  section,
  enabled,
  setEnabled,
  onDiagnostics,
}: {
  section: Section;
  enabled: string[];
  setEnabled: (ids: string[]) => void;
  onDiagnostics: () => void;
}) {
  const { workspace } = useBackend();
  const bots = useBots();
  const profile = bots.data?.items.find((b) => b.id === workspace.botId);
  const app = isAppSection(section);
  return (
    <ScrollArea className="settings-scroll" viewportLabel="Settings">
      <section className="settings-page">
        <header className="settings-page-heading">
          <div>
            <h2>{sections.find((s) => s.id === section)?.label}</h2>
            <p>
              {app
                ? "Preferences for this app and browser."
                : section === "new-bot"
                  ? "An assistant with its own identity and configuration."
                  : `Configuration for ${profile?.name ?? "this bot"}.`}
            </p>
          </div>
          <span className="settings-scope-tag">
            {app
              ? "App-wide"
              : section === "new-bot"
                ? "New bot"
                : `${profile?.name ?? "This bot"} only`}
          </span>
        </header>
        {section === "bot" ? (
          <BotSettings />
        ) : section === "personality" ? (
          <BotSettings mode="personality" />
        ) : section === "bot-history" ? (
          <BotSettings mode="history" />
        ) : section === "new-bot" ? (
          <BotSettings mode="create" />
        ) : section === "providers" ? (
          <ProviderSettings />
        ) : section === "models" ? (
          <ModelSettings />
        ) : section === "memory" ? (
          <MemorySettings />
        ) : section === "memory-browse" ? (
          <MemoryBrowse />
        ) : section === "telemetry" ? (
          <TelemetrySettings onInspect={onDiagnostics} />
        ) : section === "connection" ? (
          <ConnectionSettings />
        ) : section === "general" ? (
          <General />
        ) : (
          <Group
            title="Installed"
            note="Trusted local plugins add small pieces to your workspace through explicit UI slots. Preferences are saved in this browser."
          >
            {plugins.map((plugin) => (
              <Row
                key={plugin.id}
                title={plugin.name}
                description={
                  <>
                    {plugin.description}
                    <code>
                      {plugin.id} · v{plugin.version} ·{" "}
                      {Object.keys(plugin.slots).join(", ")}
                    </code>
                  </>
                }
              >
                <Switch
                  aria-label={`Enable ${plugin.name}`}
                  checked={enabled.includes(plugin.id)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...enabled, plugin.id]
                      : enabled.filter((id) => id !== plugin.id);
                    setEnabled(next);
                    writeLocal("raphie:plugins", JSON.stringify(next));
                  }}
                />
              </Row>
            ))}
          </Group>
        )}
      </section>
    </ScrollArea>
  );
}

function General() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(
    () => setTheme((readLocal("raphie:theme") as Theme) ?? "system"),
    [],
  );
  return (
    <>
      <Group title="Appearance">
        <Row title="Theme" description="Follow the system, or pick one.">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(
              [
                ["system", "System", Monitor],
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                role="radio"
                aria-checked={theme === value}
                onClick={() => {
                  setTheme(value);
                  writeLocal("raphie:theme", value);
                  applyTheme(value);
                }}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </Row>
      </Group>
    </>
  );
}
