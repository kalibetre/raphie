import { ArrowLeft, ChevronRight, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { Button } from "../../../shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "../../../shared/ui/sidebar";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar } from "./bot-avatar";
import { isAppSection, type Section, sections } from "./settings";

const botEntries: readonly Section[] = [
  "bot",
  "personality",
  "providers",
  "models",
  "memory",
  "telemetry",
];
const appEntries: readonly Section[] = ["connection", "general", "plugins"];
// Subpages reached from inside a page highlight their parent entry.
const parent: Partial<Record<Section, Section>> = {
  "bot-history": "personality",
  "memory-browse": "memory",
};
const label = (id: Section) => sections.find((s) => s.id === id)!.label;
const expandedKey = "raphie:settings-expanded";

/** Full-window settings: one sidebar groups every bot's pages above the app's. */
export function SettingsWindow({
  section,
  botId,
  open,
  onOpenChange,
  onSelect,
  onBack,
  children,
}: {
  section: Section;
  botId: string;
  /** Desktop expansion, shared with the chat sidebar; mobile uses a sheet. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (botId: string, section: Section) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const bots = useBots();
  const app = isAppSection(section);
  const name =
    bots.data?.items.find((b) => b.id === botId)?.name ??
    (botId === "default" ? "Raphie" : botId);
  return (
    <SidebarProvider
      className="settings-window"
      open={open}
      onOpenChange={onOpenChange}
    >
      <SettingsNav
        section={section}
        botId={botId}
        bots={bots.data?.items ?? []}
        onSelect={onSelect}
        onBack={onBack}
      />
      <SidebarInset className="settings-inset">
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
            {label(section)}
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
      </SidebarInset>
    </SidebarProvider>
  );
}

function SettingsNav({
  section,
  botId,
  bots,
  onSelect,
  onBack,
}: {
  section: Section;
  botId: string;
  bots: { id: string; name: string }[];
  onSelect: (botId: string, section: Section) => void;
  onBack: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const current = parent[section] ?? section;
  const app = isAppSection(section) || section === "new-bot";
  // Expanding only reveals pages; it never navigates, so drafts stay intact.
  // Saved because selecting another bot's page remounts the bot scope; the
  // current bot always starts open.
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(readLocal(expandedKey) ?? "[]") as unknown;
      const ids = Array.isArray(saved) ? saved.map(String) : [];
      return ids.includes(botId) ? ids : [...ids, botId];
    } catch {
      return [botId];
    }
  });
  const toggle = (id: string, open: boolean) => {
    const next = open
      ? [...new Set([...expanded, id])]
      : expanded.filter((e) => e !== id);
    setExpanded(next);
    writeLocal(expandedKey, JSON.stringify(next));
  };
  const select = (id: string, next: Section) => {
    setOpenMobile(false);
    onSelect(id, next);
  };
  return (
    <Sidebar aria-label="Settings navigation">
      <SidebarHeader className="settings-sidebar-header flex-row items-center">
        <span className="brand-mark" aria-hidden="true">
          r
        </span>
        Settings
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Settings">
          <SidebarGroup>
            <SidebarGroupLabel>Bots</SidebarGroupLabel>
            <SidebarGroupAction
              aria-label="Create a bot"
              title="Create a bot"
              onClick={() => select(botId, "new-bot")}
            >
              <Plus />
            </SidebarGroupAction>
            <SidebarMenu>
              {bots.map((bot) => {
                const open = expanded.includes(bot.id);
                const here = !app && bot.id === botId;
                return (
                  <Collapsible
                    key={bot.id}
                    open={open}
                    onOpenChange={(next) => toggle(bot.id, next)}
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          className="settings-bot-trigger"
                          // Collapsed over the current page: mark the group.
                          isActive={here && !open}
                          aria-label={`${bot.name} settings`}
                        />
                      }
                    >
                      <BotAvatar id={bot.id} />
                      <span>{bot.name}</span>
                      {bot.id === "default" && (
                        <small className="settings-default-tag">default</small>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className="settings-chevron"
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {botEntries.map((entry) => {
                          const active = here && current === entry;
                          return (
                            <SidebarMenuSubItem key={entry}>
                              <SidebarMenuSubButton
                                render={<button type="button" />}
                                className="w-full"
                                isActive={active}
                                aria-current={active ? "page" : undefined}
                                onClick={() => select(bot.id, entry)}
                              >
                                {label(entry)}
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>App</SidebarGroupLabel>
            <SidebarMenu>
              {appEntries.map((entry) => (
                <SidebarMenuItem key={entry}>
                  <SidebarMenuButton
                    isActive={section === entry}
                    aria-current={section === entry ? "page" : undefined}
                    onClick={() => select(botId, entry)}
                  >
                    {label(entry)}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onBack}>
              <ArrowLeft /> Back to conversations
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
