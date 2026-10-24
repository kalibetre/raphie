import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/ui/collapsible";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../shared/ui/sidebar";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar } from "./bot-avatar";
import {
  isAppSection,
  parentSection,
  type Section,
  sections,
} from "./settings-sections";

const botEntries: readonly Section[] = [
  "bot",
  "providers",
  "models",
  "memory",
  "mcp",
  "jobs",
  "telemetry",
  "activity",
];
const appEntries: readonly Section[] = ["connection", "general", "plugins"];
const label = (id: Section) => sections.find((s) => s.id === id)!.label;
const expandedKey = "raphie:settings-expanded";

/** Settings sidebar content: every bot's pages grouped above the app's. */
export function SettingsNav({
  section,
  botId,
  onSelect,
  onBack,
}: {
  section: Section;
  botId: string;
  onSelect: (botId: string, section: Section) => void;
  onBack: () => void;
}) {
  const bots = useBots().data?.items ?? [];
  const { setOpenMobile } = useSidebar();
  const current = parentSection[section] ?? section;
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
    <>
      <SidebarHeader className="settings-sidebar-header flex-row items-center">
        <BotAvatar id="default" />
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
    </>
  );
}
