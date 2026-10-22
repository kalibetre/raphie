import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Input({
  className,
  type,
  ...props
}: Omit<ComponentProps<typeof InputPrimitive>, "className"> & {
  className?: string;
}) {
  return (
    <InputPrimitive
      data-slot="input"
      type={type}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
