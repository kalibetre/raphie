import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";
import { SidebarTrigger } from "../../../shared/ui/sidebar";
import { useBots } from "../infrastructure/use-bots";
import { isAppSection, type Section, sectionOf } from "./settings-sections";

/** Settings page area: breadcrumb top bar above the selected section. */
export function SettingsMain({
  section,
  botId,
  onBack,
  children,
}: {
  section: Section;
  botId: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const bots = useBots();
  const app = isAppSection(section);
  const name =
    bots.data?.items.find((b) => b.id === botId)?.name ??
    (botId === "default" ? "Raphie" : botId);
  return (
    <>
      <header className="settings-topbar">
        <SidebarTrigger
          aria-label="Toggle settings navigation (⌘B)"
          title="Toggle settings navigation (⌘B)"
        />
        <p className="settings-breadcrumb">
          Settings
          <span aria-hidden="true">/</span>
          <strong>
            {app ? "App" : section === "new-bot" ? "New bot" : name}
          </strong>
          <span aria-hidden="true">/</span>
          {sectionOf(section).label}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          title="Close settings"
          onClick={onBack}
        >
          <X size={16} />
        </Button>
      </header>
      {children}
    </>
  );
}
