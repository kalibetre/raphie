import { Puzzle } from "lucide-react";

import { writeLocal } from "../../../infrastructure/preferences/storage";
import { Switch } from "../../../shared/ui/switch";
import { plugins } from "../infrastructure/plugins/index";
import { Group, Row } from "./settings-group";

export function PluginSettings({
  enabled,
  setEnabled,
}: {
  enabled: string[];
  setEnabled: (ids: string[]) => void;
}) {
  return (
    <Group
      title="Installed"
      note="Plugins add small pieces to the workspace through explicit UI slots. They never grant a bot tools or data."
    >
      {plugins.map((plugin) => (
        <Row
          key={plugin.id}
          icon={<Puzzle size={16} />}
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
  );
}
