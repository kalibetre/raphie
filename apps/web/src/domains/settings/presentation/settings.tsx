import {
  BookOpen,
  Monitor,
  Moon,
  Puzzle,
  SlidersHorizontal,
  Sun,
  Server,
  Radio,
  Brain,
  KeyRound,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Switch } from "../../../shared/ui/switch";
import { plugins } from "../infrastructure/plugins/index";
import { applyTheme, type Theme } from "../infrastructure/theme";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { ConnectionSettings } from "./connection-settings";
import { MemorySettings } from "./memory-settings";
import { ModelSettings } from "./model-settings";
import { ProviderSettings } from "./provider-settings";
import { Group, Row } from "./settings-group";
import { TelemetrySettings } from "./telemetry-settings";

export const sections = [
  { id: "connection", label: "Backend", icon: Server },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "models", label: "Models", icon: Brain },
  { id: "memory", label: "Memory", icon: BookOpen },
  { id: "telemetry", label: "Telemetry", icon: Radio },
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "plugins", label: "Plugins", icon: Puzzle },
] as const;

export type Section = (typeof sections)[number]["id"];

export function Settings({
  section,
  data,
  connected,
  enabled,
  setEnabled,
}: {
  section: Section;
  data?: Snapshot;
  connected: boolean;
  enabled: string[];
  setEnabled: (ids: string[]) => void;
}) {
  return (
    <ScrollArea className="settings-scroll" viewportLabel="Settings">
      <section className="settings-page">
        {section === "providers" ? (
          <ProviderSettings />
        ) : section === "models" ? (
          <ModelSettings />
        ) : section === "memory" ? (
          <MemorySettings />
        ) : section === "telemetry" ? (
          <TelemetrySettings />
        ) : section === "connection" ? (
          <ConnectionSettings />
        ) : section === "general" ? (
          <General data={data} connected={connected} />
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

function General({ data, connected }: { data?: Snapshot; connected: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");
  const settings = useRuntimeSettings();
  const connection = settings.data?.connections.find(
    (c) => c.id === data?.model?.provider,
  );
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
      <Group
        title="Runtime"
        note="Connection and model preferences are available in Backend, Providers, and Models."
      >
        <Row title="Runtime" description="The selected local agent backend.">
          <span className="settings-value">
            <span className={`status-dot ${connected ? "" : "offline"}`} />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </Row>
        <Row title="Model" description="Used for every conversation.">
          <span className="settings-value">
            {data?.model
              ? `${connection?.name ?? data.model.provider} · ${data.model.modelId}`
              : "Not configured"}
          </span>
        </Row>
        <Row
          title="Connected tools"
          description="MCP server Raphie can call, with your approval."
        >
          <span className="settings-value">
            {data?.mcp.connected
              ? `${data.mcp.server ?? "MCP"} · ${data.mcp.toolCount} tools`
              : data?.mcp.error
                ? "Connection failed"
                : "None"}
          </span>
        </Row>
      </Group>
    </>
  );
}
