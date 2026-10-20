import { useEffect, useState } from "react";

import { readLocal } from "../../../../infrastructure/preferences/storage";
import { plugins } from "./index";

export function useEnabledPlugins() {
  const [enabled, setEnabled] = useState(plugins.map((p) => p.id));
  useEffect(() => {
    try {
      const saved = JSON.parse(readLocal("raphie:plugins") ?? "null");
      if (Array.isArray(saved) && saved.every((id) => typeof id === "string"))
        setEnabled(
          saved.filter((id) => plugins.some((plugin) => plugin.id === id)),
        );
    } catch {
      // Ignore malformed preferences and retain the default plugin selection.
    }
  }, []);
  return [enabled, setEnabled] as const;
}
