import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/**
 * A single-thumb slider. `thumbLabel` names it for screen readers, and
 * `valueText` says its value in words when the number means nothing.
 */
export function Slider({
  className,
  thumbLabel,
  valueText,
  ...props
}: Omit<ComponentProps<typeof SliderPrimitive.Root<number>>, "className"> & {
  className?: string;
  thumbLabel: string;
  valueText?: string;
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative w-full touch-none select-none", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full items-center px-2">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--border)]">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-[var(--accent)]" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            aria-valuetext={valueText}
            className="size-4 rounded-full bg-card shadow-[0_0_0_2px_var(--accent),0_1px_3px_#0003] outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_var(--accent),0_0_0_5px_color-mix(in_srgb,var(--accent)_30%,transparent)] data-disabled:opacity-50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
