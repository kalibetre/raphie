import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  collisionPadding = 12,
  ...props
}: Omit<ComponentProps<typeof PopoverPrimitive.Popup>, "className"> & {
  className?: string;
  align?: ComponentProps<typeof PopoverPrimitive.Positioner>["align"];
  side?: ComponentProps<typeof PopoverPrimitive.Positioner>["side"];
  sideOffset?: number;
  collisionPadding?: number;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="z-60"
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
