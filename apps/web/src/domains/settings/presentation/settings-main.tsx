import { ChevronRight, Settings2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";
import { SidebarTrigger } from "../../../shared/ui/sidebar";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar, botTone } from "./bot-avatar";
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
  const Icon = sectionOf(section).icon;
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
        <nav className="settings-breadcrumb" aria-label="Settings location">
          <span className="settings-breadcrumb-root">
            <Settings2 size={14} aria-hidden="true" />
            Settings
          </span>
          <ChevronRight
            className="settings-breadcrumb-divider"
            size={12}
            aria-hidden="true"
          />
          <span className={`settings-breadcrumb-scope tone-${botTone(botId)}`}>
            {!app && section !== "new-bot" && <BotAvatar id={botId} />}
            <span className="settings-breadcrumb-label">
              {app ? "App" : section === "new-bot" ? "New bot" : name}
            </span>
          </span>
          <ChevronRight
            className="settings-breadcrumb-divider"
            size={12}
            aria-hidden="true"
          />
          <span className="settings-breadcrumb-page" aria-current="page">
            <Icon size={14} aria-hidden="true" />
            <span className="settings-breadcrumb-label">
              {sectionOf(section).label}
            </span>
          </span>
        </nav>
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
