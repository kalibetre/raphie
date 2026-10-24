import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../../shared/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs";
import { useIsMobile } from "../../shared/ui/use-mobile";
import { PanelResizeHandle } from "./panel-resize-handle";

export type PanelTab = {
  id: string;
  label: string;
  /** Count shown beside the label, e.g. conversations needing attention. */
  badge?: number;
  content: ReactNode;
};

/**
 * The workspace's right-hand panel: tabs beside the conversation on desktop,
 * a sheet on mobile. Add a tab by adding an entry to `tabs`.
 */
export function WorkspacePanel({
  open,
  onOpenChange,
  tabs,
  width,
  maxWidth,
  onResize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: PanelTab[];
  width: number;
  maxWidth: number;
  onResize: (width: number) => void;
}) {
  const mobile = useIsMobile();
  const content = (
    <Tabs defaultValue={tabs[0]?.id} className="workspace-panel-tabs">
      <TabsList
        aria-label="Workspace tools"
        variant="line"
        className="workspace-panel-tab-list h-11! w-full justify-start border-b border-border px-3"
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
            {!!tab.badge && <span className="reply-count">{tab.badge}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          className="workspace-panel-content"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="gap-0 bg-sidebar p-0 pt-10 data-[side=right]:w-[min(360px,100%)] sm:max-w-none">
          <SheetTitle className="sr-only">Workspace panel</SheetTitle>
          <SheetDescription className="sr-only">
            Conversations and other workspace tools.
          </SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside className="inspector workspace-panel" aria-label="Workspace panel">
      <PanelResizeHandle
        side="right"
        value={width}
        maxWidth={maxWidth}
        onChange={onResize}
      />
      {content}
    </aside>
  );
}
