import { useEffect, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";

const key = "raphie:model-favorites";

export function useModelFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(readLocal(key) ?? "[]");
      if (Array.isArray(value))
        setFavorites(
          value
            .filter((id): id is string => typeof id === "string")
            .slice(0, 200),
        );
    } catch {
      /* A malformed browser preference must not block chat. */
    }
  }, []);

  function toggle(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [...favorites, id].slice(-200);
    setFavorites(next);
    writeLocal(key, JSON.stringify(next));
  }

  return { favorites, toggle };
}
