import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Switch({
  className,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive.Root>, "className"> & {
  className?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
