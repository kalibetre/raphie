import { useEffect, useState } from "react";

import { applyTheme } from "../../domains/settings/infrastructure/theme";
import {
  readLocal,
  writeLocal,
} from "../../infrastructure/preferences/storage";

export function useWorkspaceLayout() {
  const [sidebar, setSidebar] = useState(false);
  const [navigationWidth, setNavigationWidth] = useState(264);
  const [viewportWidth, setViewportWidth] = useState(1440);
  useEffect(() => {
    const update = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth >= 768) setSidebar(false);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const left = Number(readLocal("raphie:navigation-width"));
    if (Number.isFinite(left) && left >= 220 && left <= 480)
      setNavigationWidth(left);
  }, []);

  function resizePanel(value: number) {
    setNavigationWidth(value);
    writeLocal("raphie:navigation-width", String(value));
  }

  useEffect(() => {
    applyTheme();
  }, []);
  // Desktop collapse; on small screens the sidebar is an overlay instead.
  const [collapsed, setCollapsed] = useState(false);

  function collapse(value: boolean) {
    setCollapsed(value);
    writeLocal("raphie:sidebar-collapsed", String(value));
  }

  function toggleCollapsed() {
    setCollapsed((value) => {
      writeLocal("raphie:sidebar-collapsed", String(!value));
      return !value;
    });
  }

  // The shadcn SidebarProvider owns the ⌘B shortcut.
  useEffect(() => {
    setCollapsed(readLocal("raphie:sidebar-collapsed") === "true");
  }, []);
  const visibleNavigationWidth = Math.min(
    navigationWidth,
    Math.max(220, viewportWidth - 320),
  );
  const navigationMax = Math.min(480, Math.max(220, viewportWidth - 320));
  return {
    sidebar,
    setSidebar,
    collapsed,
    collapse,
    toggleCollapsed,
    resizePanel,
    visibleNavigationWidth,
    navigationMax,
  };
}
