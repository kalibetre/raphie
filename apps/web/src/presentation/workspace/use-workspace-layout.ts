import { useEffect, useState } from "react";

import { applyTheme } from "../../domains/settings/infrastructure/theme";
import {
  readLocal,
  writeLocal,
} from "../../infrastructure/preferences/storage";

// The conversations panel stays open per bot: switching bots remounts the
// workspace, so the open state lives in storage rather than component state.
const inspectorKey = (botId: string) => `raphie:inspector-open:${botId}`;

export function useWorkspaceLayout(
  view: "settings" | undefined,
  botId: string,
) {
  const [inspector, setInspectorValue] = useState(
    () => readLocal(inspectorKey(botId)) === "true",
  );
  useEffect(() => {
    setInspectorValue(readLocal(inspectorKey(botId)) === "true");
  }, [botId]);

  function setInspector(open: boolean) {
    setInspectorValue(open);
    writeLocal(inspectorKey(botId), String(open));
  }

  const [sidebar, setSidebar] = useState(false);
  const [navigationWidth, setNavigationWidth] = useState(264);
  const [activityWidth, setActivityWidth] = useState(340);
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
    const right = Number(readLocal("raphie:activity-width"));
    if (Number.isFinite(left) && left >= 220 && left <= 480)
      setNavigationWidth(left);
    if (Number.isFinite(right) && right >= 280 && right <= 640)
      setActivityWidth(right);
  }, []);

  function resizePanel(side: "left" | "right", value: number) {
    if (side === "left") {
      setNavigationWidth(value);
      writeLocal("raphie:navigation-width", String(value));
    } else {
      setActivityWidth(value);
      writeLocal("raphie:activity-width", String(value));
    }
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
  const dockedActivity = inspector && !view && viewportWidth >= 768;
  const visibleNavigationWidth = Math.min(
    navigationWidth,
    Math.max(220, viewportWidth - 320 - (dockedActivity ? 280 : 0)),
  );
  const visibleActivityWidth = Math.min(
    activityWidth,
    Math.max(
      280,
      dockedActivity
        ? viewportWidth - (collapsed ? 0 : visibleNavigationWidth) - 320
        : viewportWidth - 40,
    ),
  );
  const navigationMax = Math.min(
    480,
    Math.max(
      220,
      viewportWidth - 320 - (dockedActivity ? visibleActivityWidth : 0),
    ),
  );
  const activityMax = Math.min(
    640,
    Math.max(
      280,
      dockedActivity
        ? viewportWidth - (collapsed ? 0 : visibleNavigationWidth) - 320
        : viewportWidth - 40,
    ),
  );
  return {
    inspector,
    setInspector,
    sidebar,
    setSidebar,
    collapsed,
    collapse,
    toggleCollapsed,
    resizePanel,
    visibleNavigationWidth,
    visibleActivityWidth,
    navigationMax,
    activityMax,
  };
}
