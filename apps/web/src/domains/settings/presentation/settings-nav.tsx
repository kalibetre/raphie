import { ArrowLeft } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuButton,
} from "../../../shared/ui/sidebar";
import { type Section, sections } from "./settings";

// Child items render indented under the item before them.
const groups = [
  { label: "Preferences", ids: ["general", "plugins"] },
  { label: "Memory", ids: ["memory", "memory-browse"] },
  { label: "Runtime", ids: ["connection", "providers", "models", "telemetry"] },
] as const;
const children: readonly Section[] = ["memory-browse"];

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
          {groups.map(({ label, ids }) => (
            <SidebarGroup key={label} label={label}>
              {ids.map((id) => {
                const item = sections.find((entry) => entry.id === id)!;
                const Icon = item.icon;
                return (
                  <SidebarMenuButton
                    key={id}
                    active={section === id}
                    className={children.includes(id) ? "pl-8" : undefined}
                    onClick={() => onSelect(id)}
                  >
                    <Icon size={15} aria-hidden="true" /> {item.label}
                  </SidebarMenuButton>
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
