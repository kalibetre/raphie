import { ArrowLeft, BookOpen } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuButton,
  SidebarMenuCollapsible,
  SidebarMenuSubButton,
} from "../../../shared/ui/sidebar";
import { type Section, sections } from "./settings";

// An entry is a section, or a collapsible parent whose children are sections.
type Entry =
  | Section
  | {
      label: string;
      icon: typeof BookOpen;
      children: readonly { id: Section; label: string }[];
    };

const groups: readonly { label: string; entries: readonly Entry[] }[] = [
  { label: "Preferences", entries: ["general", "plugins"] },
  {
    label: "Workspace",
    entries: [
      {
        label: "Memory",
        icon: BookOpen,
        children: [
          { id: "memory", label: "Configuration" },
          { id: "memory-browse", label: "Browse" },
        ],
      },
    ],
  },
  {
    label: "Runtime",
    entries: ["connection", "providers", "models", "telemetry"],
  },
];

export function SettingsNav({
  section,
  open,
  onOpenChange,
  onSelect,
  onBack,
}: {
  section: Section;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (section: Section) => void;
  onBack: () => void;
}) {
  return (
    <Sidebar
      label="Settings navigation"
      open={open}
      onOpenChange={onOpenChange}
    >
      <SidebarHeader>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            r
          </span>
          Settings
        </div>
      </SidebarHeader>
      <SidebarContent label="Settings sections">
        <nav aria-label="Settings">
          {groups.map(({ label, entries }) => (
            <SidebarGroup key={label} label={label}>
              {entries.map((entry) => {
                if (typeof entry === "string") {
                  const item = sections.find((s) => s.id === entry)!;
                  const Icon = item.icon;
                  return (
                    <SidebarMenuButton
                      key={entry}
                      active={section === entry}
                      onClick={() => onSelect(entry)}
                    >
                      <Icon size={15} aria-hidden="true" /> {item.label}
                    </SidebarMenuButton>
                  );
                }
                const Icon = entry.icon;
                return (
                  <SidebarMenuCollapsible
                    key={entry.label}
                    label={entry.label}
                    icon={<Icon size={15} aria-hidden="true" />}
                    defaultOpen={entry.children.some((c) => c.id === section)}
                  >
                    {entry.children.map((child) => (
                      <SidebarMenuSubButton
                        key={child.id}
                        active={section === child.id}
                        onClick={() => onSelect(child.id)}
                      >
                        {child.label}
                      </SidebarMenuSubButton>
                    ))}
                  </SidebarMenuCollapsible>
                );
              })}
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to conversations
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
