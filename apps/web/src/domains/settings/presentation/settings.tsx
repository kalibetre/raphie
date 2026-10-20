import { Monitor, Moon, Puzzle, SlidersHorizontal, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { plugins } from "../infrastructure/plugins/index";
import { applyTheme, type Theme } from "../infrastructure/theme";

export const sections = [
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
    <section className="settings-page">
      {section === "general" ? (
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
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Enable ${plugin.name}`}
                  checked={enabled.includes(plugin.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...enabled, plugin.id]
                      : enabled.filter((id) => id !== plugin.id);
                    setEnabled(next);
                    writeLocal("raphie:plugins", JSON.stringify(next));
                  }}
                />
                <span aria-hidden="true" />
              </label>
            </Row>
          ))}
        </Group>
      )}
    </section>
  );
}

function General({ data, connected }: { data?: Snapshot; connected: boolean }) {
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
      <Group
        title="Runtime"
        note="Configured on the runtime through Varlock. Read-only here."
      >
        <Row title="Runtime" description="The local agent host on 127.0.0.1.">
          <span className="settings-value">
            <span className={`status-dot ${connected ? "" : "offline"}`} />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </Row>
        <Row title="Model" description="Used for every conversation.">
          <span className="settings-value">
            {data?.model
              ? `${data.model.provider} · ${data.model.modelId}`
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

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-group">
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      <div className="settings-card">{children}</div>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
