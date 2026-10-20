import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";

export type Theme = "system" | "light" | "dark";

export function applyTheme(theme = readLocal("raphie:theme") ?? "system") {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme
    ? theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
}

// The quick switcher picks an explicit theme; Settings can return to System.
export function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  writeLocal("raphie:theme", next);
  applyTheme(next);
  return next === "dark";
}
