import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Popup>, "className"> & {
  className?: string;
  side?: ComponentProps<typeof TooltipPrimitive.Positioner>["side"];
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="z-70"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "w-fit rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
