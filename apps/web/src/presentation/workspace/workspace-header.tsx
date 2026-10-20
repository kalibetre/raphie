import { Menu, PanelLeft, PanelRight } from "lucide-react";

import { Button } from "../../shared/ui/button";

export function WorkspaceHeader({
  title,
  breadcrumb,
  collapsed,
  inspector,
  showInspector,
  onOpenNavigation,
  onToggleNavigation,
  onToggleInspector,
}: {
  title: string | undefined;
  breadcrumb: string;
  collapsed: boolean;
  inspector: boolean;
  showInspector: boolean;
  onOpenNavigation: () => void;
  onToggleNavigation: () => void;
  onToggleInspector: () => void;
}) {
  return (
    <header className="workspace-header">
      <div>
        <Button
          className="md:hidden"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => {
            onOpenNavigation();
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLButtonElement>(
                  '[aria-label="Close navigation"]',
                )
                ?.focus(),
            );
          }}
        >
          <Menu />
        </Button>
        <Button
          className="-ml-2 hidden text-muted-foreground md:inline-flex"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
          aria-pressed={!collapsed}
          onClick={onToggleNavigation}
        >
          <PanelLeft size={16} />
        </Button>
        <span className="breadcrumb">{breadcrumb}</span>
        <span className="breadcrumb-sep">/</span>
        <h1>{title}</h1>
      </div>
      <div>
        {showInspector && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle activity inspector"
            aria-pressed={inspector}
            onClick={onToggleInspector}
          >
            <PanelRight size={16} />
          </Button>
        )}
      </div>
    </header>
  );
}
