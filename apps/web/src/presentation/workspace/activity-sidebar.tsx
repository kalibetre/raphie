import { Activity } from "../../domains/activity/presentation/activity";
import type { ActivityEvent } from "../../infrastructure/http/api-client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../../shared/ui/sheet";
import { useIsMobile } from "../../shared/ui/use-mobile";
import { PanelResizeHandle } from "./panel-resize-handle";

/** Dock beside the conversation on desktop; use the shared sheet on mobile. */
export function ActivitySidebar({
  open,
  onOpenChange,
  events,
  width,
  maxWidth,
  onResize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: ActivityEvent[];
  width: number;
  maxWidth: number;
  onResize: (width: number) => void;
}) {
  const mobile = useIsMobile();
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="gap-0 bg-sidebar p-0 pt-10 data-[side=right]:w-[min(340px,100%)] sm:max-w-none">
          <SheetTitle className="sr-only">Activity</SheetTitle>
          <SheetDescription className="sr-only">
            Events from this conversation.
          </SheetDescription>
          <Activity events={events} />
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside className="inspector" aria-label="Conversation activity">
      <PanelResizeHandle
        side="right"
        value={width}
        maxWidth={maxWidth}
        onChange={onResize}
      />
      <Activity events={events} />
    </aside>
  );
}
