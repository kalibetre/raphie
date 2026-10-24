import { useEffect, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { applyTheme, type Theme } from "../infrastructure/theme";
import { Group } from "./settings-group";

const themes = [
  ["system", "System", "Follows your device"],
  ["light", "Light", "Warm paper"],
  ["dark", "Dark", "Evening ink"],
] as const;

/** Theme picker: each choice previews the workspace in that palette. */
export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(
    () => setTheme((readLocal("raphie:theme") as Theme) ?? "system"),
    [],
  );
  return (
    <Group title="Theme" note="Saved in this browser.">
      <div className="theme-choices" role="radiogroup" aria-label="Theme">
        {themes.map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className="theme-choice"
            onClick={() => {
              setTheme(value);
              writeLocal("raphie:theme", value);
              applyTheme(value);
            }}
          >
            <span
              className={`theme-preview theme-preview-${value}`}
              aria-hidden="true"
            >
              <i />
              <b />
              <b />
            </span>
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
    </Group>
  );
}
