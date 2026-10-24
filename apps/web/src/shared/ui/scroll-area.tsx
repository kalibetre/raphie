import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { ComponentProps, Ref } from "react";

import { cn } from "./utils";

type ScrollAreaProps = Omit<
  ComponentProps<typeof ScrollAreaPrimitive.Root>,
  "className"
> & {
  className?: string;
  viewportRef?: Ref<HTMLDivElement>;
  viewportLabel?: string;
  orientation?: "vertical" | "horizontal" | "both";
};

export function ScrollArea({
  className,
  children,
  viewportRef,
  viewportLabel,
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0 min-w-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        aria-label={viewportLabel}
        role={viewportLabel ? "group" : undefined}
        className="scroll-area-viewport size-full rounded-[inherit] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* Base UI grows content to fit-content so wide children can scroll
            sideways. A vertical-only area must instead stay the viewport width,
            or one long code line widens the whole thread and clips it. */}
        <ScrollAreaPrimitive.Content
          style={orientation === "vertical" ? { minWidth: "100%" } : undefined}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" && <ScrollBar />}
      {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: Omit<ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>, "className"> & {
  className?: string;
}) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical"
          ? "h-full w-2.5 border-l border-l-transparent"
          : "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
