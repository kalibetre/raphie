import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";
import { SidebarTrigger, useSidebar } from "../../../shared/ui/sidebar";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar } from "./bot-avatar";
import { useBotStyle } from "./bot-tones";
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
  const botStyle = useBotStyle();
  const bots = useBots();
  const { isMobile, open, openMobile } = useSidebar();
  const navigationOpen = isMobile ? openMobile : open;
  const NavigationIcon = isMobile
    ? Menu
    : navigationOpen
      ? ChevronsLeft
      : ChevronsRight;
  const app = isAppSection(section);
  const Icon = sectionOf(section === "personality" ? "bot" : section).icon;
  const name =
    bots.data?.items.find((b) => b.id === botId)?.name ??
    (botId === "default" ? "Raphie" : botId);
  return (
    <>
      <header className="settings-topbar">
        <SidebarTrigger
          className="navigation-toggle"
          aria-label="Toggle settings navigation (⌘B)"
          aria-expanded={navigationOpen}
          title={`${navigationOpen ? "Hide" : "Show"} settings navigation (⌘B)`}
        >
          <NavigationIcon size={16} aria-hidden="true" />
        </SidebarTrigger>
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
          {!app && (
            <>
              <span
                className="settings-breadcrumb-scope"
                style={botStyle(botId)}
              >
                {section !== "new-bot" && <BotAvatar id={botId} />}
                <span className="settings-breadcrumb-label">
                  {section === "new-bot" ? "New bot" : name}
                </span>
              </span>
              <ChevronRight
                className="settings-breadcrumb-divider"
                size={12}
                aria-hidden="true"
              />
            </>
          )}
          <span className="settings-breadcrumb-page" aria-current="page">
            <Icon size={14} aria-hidden="true" />
            <span className="settings-breadcrumb-label">
              {sectionOf(section === "personality" ? "bot" : section).label}
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
